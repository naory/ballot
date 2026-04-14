/**
 * HCS message handler — processes incoming poll_created and vote messages.
 * Extracted from index.ts so the validation logic can be unit-tested
 * without spinning up the full subscriber.
 */

import { insertPoll, insertVote, getPoll } from "./db.js";
import { verifyVoteProof as defaultVerify } from "./verifier.js";
import { verifyCredentialVoteProof as defaultCredentialVerify } from "./verifier_credential.js";
import type { HCSVoteMessage, HCSPollMessage, ZKProof, IdosConfig } from "@ballot/core";

/**
 * Parse an HCS consensus timestamp ("seconds.nanoseconds") into a Date.
 * Mirror Node timestamps are Unix seconds with up to nanosecond precision,
 * e.g. "1712000000.123456789". Only millisecond precision is used here.
 */
export function parseConsensusTimestamp(ts: string): Date {
  const [secs, nanos = "0"] = ts.split(".");
  const ms = Number(secs) * 1000 + Math.floor(Number(nanos.padEnd(9, "0")) / 1_000_000);
  return new Date(ms);
}

/**
 * Process a single decoded HCS message.
 *
 * @param topicId   - HCS topic the message arrived on
 * @param message   - Decoded JSON payload
 * @param timestamp - HCS consensus timestamp ("seconds.nanoseconds")
 * @param onNewPoll - Called after a poll_created is persisted so the
 *                    subscriber can begin watching the new topic
 * @param verify    - ZK proof verifier; injectable for testing (defaults to
 *                    the real snarkjs verifier)
 */
export async function handleMessage(
  topicId: string,
  message: unknown,
  timestamp: string,
  onNewPoll: (topicId: string) => void,
  verify: (proof: ZKProof, signals: string[]) => Promise<boolean> = defaultVerify,
  verifyCredential: (proof: ZKProof, signals: string[]) => Promise<boolean> = defaultCredentialVerify
): Promise<void> {
  const msg = message as { type: string };

  // ── poll_created ────────────────────────────────────────────────────────────
  if (msg.type === "poll_created") {
    const poll = message as HCSPollMessage;
    console.log(`[indexer] New poll: "${poll.title}" on topic ${topicId}`);
    insertPoll({
      topicId,
      title:         poll.title,
      description:   poll.description,
      choices:       poll.choices,
      tokenId:       poll.tokenId,
      merkleRoot:    poll.merkleRoot,
      serials:       poll.serials,
      startsAt:      poll.startsAt,
      endsAt:        poll.endsAt,
      idosConfig:    poll.idosConfig,
      credentialIds: poll.credentialIds,
    });
    onNewPoll(topicId);
    return;
  }

  // ── vote ────────────────────────────────────────────────────────────────────
  if (msg.type === "vote") {
    const vote = message as HCSVoteMessage;

    // Resolve the poll this vote targets
    const poll = getPoll(vote.pollTopicId) as Record<string, unknown> | undefined;
    if (!poll) {
      console.warn(`[indexer] Rejected: vote for unknown poll ${vote.pollTopicId}`);
      return;
    }

    // Enforce voting window using the HCS consensus timestamp (not wall clock).
    // This is tamper-resistant: the timestamp is set by the Hedera network.
    const voteTime = parseConsensusTimestamp(timestamp);
    const startsAt = new Date(poll.starts_at as string);
    const endsAt   = new Date(poll.ends_at as string);

    if (voteTime < startsAt) {
      console.warn(
        `[indexer] Rejected: vote before poll opens — ` +
        `vote at ${voteTime.toISOString()}, opens at ${poll.starts_at}`
      );
      return;
    }
    if (voteTime > endsAt) {
      console.warn(
        `[indexer] Rejected: vote after poll closes — ` +
        `vote at ${voteTime.toISOString()}, closed at ${poll.ends_at}`
      );
      return;
    }

    // Enforce choice bounds. The ZK circuit only constrains choiceIndex < 256
    // (Num2Bits(8)); the indexer enforces the tighter bound against the actual
    // choice list so invalid indices are rejected before touching the DB.
    const choices = JSON.parse(poll.choices as string) as string[];
    if (vote.choiceIndex < 0 || vote.choiceIndex >= choices.length) {
      console.warn(
        `[indexer] Rejected: choiceIndex ${vote.choiceIndex} out of bounds ` +
        `(poll has ${choices.length} choices)`
      );
      return;
    }

    console.log(
      `[indexer] Vote on ${topicId}, ` +
      `choice=${vote.choiceIndex} ("${choices[vote.choiceIndex]}"), ` +
      `nullifier=${vote.nullifier}`
    );

    // Determine whether this poll requires idOS credential proof
    const idosConfig: IdosConfig | null = poll.idos_config
      ? JSON.parse(poll.idos_config as string)
      : null;

    if (idosConfig) {
      // Credential-gated poll: must use the vote_with_credential circuit
      if (!vote.credentialNullifier) {
        console.warn(`[indexer] Rejected: credential-gated poll requires credentialNullifier`);
        return;
      }
      const credValid = await verifyCredential(vote.proof, vote.publicSignals);
      if (!credValid) {
        console.warn(`[indexer] Rejected: invalid credential ZK proof for nullifier ${vote.nullifier}`);
        return;
      }
    } else {
      const valid = await verify(vote.proof, vote.publicSignals);
      if (!valid) {
        console.warn(`[indexer] Rejected: invalid ZK proof for nullifier ${vote.nullifier}`);
        return;
      }
    }

    const inserted = insertVote({
      topicId:             vote.pollTopicId,
      choiceIndex:         vote.choiceIndex,
      nullifier:           vote.nullifier,
      proof:               JSON.stringify(vote.proof),
      publicSignals:       vote.publicSignals,
      consensusTs:         timestamp,
      credentialNullifier: vote.credentialNullifier,
    });

    if (!inserted) {
      console.warn(`[indexer] Rejected: duplicate nullifier ${vote.nullifier}`);
    } else {
      console.log(`[indexer] Vote counted for topic ${vote.pollTopicId}`);
    }
  }
}
