/**
 * Indexer entry point.
 * On startup: loads all known polls from DB and subscribes to their HCS topics.
 * Incoming messages are ZK-verified before being counted.
 */

import { HCSSubscriber } from "./subscriber.js";
import { handleMessage } from "./handler.js";
import { getAllPolls, getDb } from "./db.js";
import { startApi } from "./api.js";
import { loadVkey, voteVkeyPath, credentialVkeyPath } from "./vkey.js";

const PORT = Number(process.env.PORT) || 4000;

// Preflight the verification keys at startup (F8) so a missing/unreadable key is
// surfaced immediately, instead of silently rejecting every vote at runtime.
for (const [label, p] of [
  ["vote", voteVkeyPath()],
  ["vote_with_credential", credentialVkeyPath()],
] as const) {
  try {
    loadVkey(p);
    console.log(`[indexer] ${label} verification key OK (${p})`);
  } catch (err) {
    console.warn(
      `[indexer] WARNING: ${label} verification key unavailable — ` +
        `${err instanceof Error ? err.message : err} ` +
        `Votes requiring it will be rejected until it is provided.`
    );
  }
}

// Only accept poll_created messages paid for by this account (F6). Defaults to
// the operator that creates polls; leave unset to disable the check (dev only).
const TRUSTED_CREATOR =
  process.env.BALLOT_CREATOR_ACCOUNT_ID || process.env.HEDERA_OPERATOR_ID;
if (!TRUSTED_CREATOR) {
  console.warn(
    "[indexer] WARNING: BALLOT_CREATOR_ACCOUNT_ID / HEDERA_OPERATOR_ID not set — " +
    "poll_created authenticity is NOT enforced (F6). Any account can define polls."
  );
}

// Ensure DB + schema exist
getDb();

// Message handler — processes incoming HCS messages for any tracked topic
const subscriber = new HCSSubscriber(
  (topicId: string, message: unknown, timestamp: string, payerAccountId?: string) =>
    handleMessage(
      topicId,
      message,
      timestamp,
      (newTopicId) => {
        // Subscribe to the new topic so votes arriving after poll_created are processed
        subscriber.subscribe(newTopicId);
      },
      undefined,
      undefined,
      { payerAccountId, trustedCreator: TRUSTED_CREATOR }
    )
);

// Load all known polls from DB and subscribe to their HCS topics
const existingPolls = getAllPolls() as { topic_id: string }[];
for (const poll of existingPolls) {
  subscriber.subscribe(poll.topic_id);
  console.log(`[indexer] Resuming subscription for topic ${poll.topic_id}`);
}

subscriber.start();
console.log(`[indexer] HCS subscriber started (${existingPolls.length} existing polls)`);

// Start REST + GraphQL API
startApi(PORT);
console.log(`[indexer] Ballot indexer running on port ${PORT}`);
