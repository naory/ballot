/**
 * Tests for handleMessage and parseConsensusTimestamp.
 *
 * Covers the security-critical validations added in Phase 5:
 *   - Poll expiry enforcement (reject votes outside startsAt / endsAt)
 *   - choiceIndex bounds check (reject index >= choices.length)
 *   - Unknown poll rejection
 *
 * The ZK verifier is injected directly (no vi.mock needed).
 * DB uses in-memory SQLite.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { ZKProof } from "@ballot/core";

process.env.DB_PATH = ":memory:";

const { handleMessage, parseConsensusTimestamp } = await import("./handler.js");
const { insertPoll, getTally, getPoll } = await import("./db.js");

// ── Helpers ─────────────────────────────────────────────────────────────────

const alwaysValid   = async () => true;
const alwaysInvalid = async () => false;

const fakeProof: ZKProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [["1", "2"], ["3", "4"], ["1", "0"]],
  pi_c: ["5", "6", "1"],
  protocol: "groth16",
  curve: "bn128",
};

// Poll window: 2026-04-01 → 2026-04-08
const STARTS_AT = "2026-04-01T00:00:00.000Z";
const ENDS_AT   = "2026-04-08T00:00:00.000Z";

/** Convert an ISO timestamp to HCS consensus timestamp format, with an optional offset in seconds. */
function toHcsTs(iso: string, offsetSeconds = 0): string {
  const unix = Math.floor(new Date(iso).getTime() / 1000) + offsetSeconds;
  return `${unix}.000000000`;
}

const TS_BEFORE = toHcsTs(STARTS_AT, -1);    // 1 second before open
const TS_OPEN   = toHcsTs(STARTS_AT,  0);    // exactly at open
const TS_DURING = toHcsTs(STARTS_AT, 3600);  // 1 hour in
const TS_CLOSE  = toHcsTs(ENDS_AT,    0);    // exactly at close
const TS_AFTER  = toHcsTs(ENDS_AT,    1);    // 1 second after close

const POLL_TOPIC = "0.0.6001";

const basePoll = {
  topicId:   POLL_TOPIC,
  title:     "Handler Test Poll",
  choices:   ["Yes", "No"],
  tokenId:   "0.0.800",
  merkleRoot: "777",
  startsAt:  STARTS_AT,
  endsAt:    ENDS_AT,
};

function makeVote(nullifier: string, choiceIndex = 0) {
  return {
    type: "vote" as const,
    pollTopicId: POLL_TOPIC,
    choiceIndex,
    nullifier,
    proof: fakeProof,
    publicSignals: ["777", nullifier, String(choiceIndex)],
  };
}

const noop = () => {};

beforeAll(() => {
  insertPoll(basePoll);
});

// ── parseConsensusTimestamp ──────────────────────────────────────────────────

describe("parseConsensusTimestamp", () => {
  // Derive the expected unix second from the ISO string so this test stays correct
  const UNIX_APR1 = Math.floor(new Date("2026-04-01T00:00:00.000Z").getTime() / 1000);

  it("parses whole-second timestamps", () => {
    const d = parseConsensusTimestamp(`${UNIX_APR1}.000000000`);
    expect(d.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("parses sub-second timestamps to millisecond precision", () => {
    const d = parseConsensusTimestamp(`${UNIX_APR1}.500000000`);
    expect(d.getTime()).toBe(new Date("2026-04-01T00:00:00.000Z").getTime() + 500);
  });

  it("handles missing nanosecond part", () => {
    const d = parseConsensusTimestamp(`${UNIX_APR1}`);
    expect(d.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

// ── poll_created ─────────────────────────────────────────────────────────────

describe("handleMessage — poll_created", () => {
  it("inserts the poll and calls onNewPoll", async () => {
    const newTopics: string[] = [];
    await handleMessage(
      "0.0.7001",
      {
        type: "poll_created",
        title: "New Poll",
        choices: ["A", "B"],
        tokenId: "0.0.900",
        merkleRoot: "888",
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      },
      TS_DURING,
      (t) => newTopics.push(t),
      alwaysValid
    );

    expect(newTopics).toEqual(["0.0.7001"]);
  });
});

// ── poll_created — creator authorization (F6) ────────────────────────────────
// A forged poll_created (injected by anyone who knows the topic ID) must not be
// accepted as the poll definition. When a trusted creator account is configured,
// only poll_created messages paid for by that account are accepted.

describe("handleMessage — poll_created authorization (F6)", () => {
  const CREATOR = "0.0.5000";

  const forgedPoll = {
    type: "poll_created" as const,
    title: "Forged Poll",
    choices: ["A", "B"],
    tokenId: "0.0.901",
    merkleRoot: "111",
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
  };

  it("rejects poll_created from an unauthorized payer", async () => {
    const newTopics: string[] = [];
    await handleMessage(
      "0.0.7200",
      forgedPoll,
      TS_DURING,
      (t) => newTopics.push(t),
      alwaysValid,
      undefined,
      { payerAccountId: "0.0.9999", trustedCreator: CREATOR }
    );
    expect(newTopics).toEqual([]);
    expect(getPoll("0.0.7200")).toBeUndefined();
  });

  it("accepts poll_created from the authorized creator", async () => {
    const newTopics: string[] = [];
    await handleMessage(
      "0.0.7201",
      { ...forgedPoll, title: "Legit Poll" },
      TS_DURING,
      (t) => newTopics.push(t),
      alwaysValid,
      undefined,
      { payerAccountId: CREATOR, trustedCreator: CREATOR }
    );
    expect(newTopics).toEqual(["0.0.7201"]);
    expect(getPoll("0.0.7201")).toBeDefined();
  });

  it("accepts poll_created when no trusted creator is configured (back-compat)", async () => {
    const newTopics: string[] = [];
    await handleMessage(
      "0.0.7202",
      { ...forgedPoll, title: "Unconfigured Poll" },
      TS_DURING,
      (t) => newTopics.push(t),
      alwaysValid
    );
    expect(newTopics).toEqual(["0.0.7202"]);
  });
});

// ── vote — voting window enforcement ────────────────────────────────────────

describe("handleMessage — vote window enforcement", () => {
  it("rejects a vote before startsAt", async () => {
    await handleMessage(POLL_TOPIC, makeVote("wv-before"), TS_BEFORE, noop, alwaysValid);
    expect(getTally(POLL_TOPIC).find((r) => r.choiceIndex === 0)?.count ?? 0).toBe(0);
  });

  it("accepts a vote exactly at startsAt", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("wv-open"), TS_OPEN, noop, alwaysValid);
    const after = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    expect(after).toBe(before + 1);
  });

  it("accepts a vote during the window", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("wv-during"), TS_DURING, noop, alwaysValid);
    const after = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    expect(after).toBe(before + 1);
  });

  it("accepts a vote exactly at endsAt", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("wv-close"), TS_CLOSE, noop, alwaysValid);
    const after = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    expect(after).toBe(before + 1);
  });

  it("rejects a vote after endsAt", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("wv-after"), TS_AFTER, noop, alwaysValid);
    const after = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    expect(after).toBe(before); // unchanged
  });
});

// ── vote — choiceIndex bounds ────────────────────────────────────────────────

describe("handleMessage — choiceIndex bounds", () => {
  it("accepts choiceIndex = 0 (first choice)", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("ci-0", 0), TS_DURING, noop, alwaysValid);
    expect(getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0)).toBe(before + 1);
  });

  it("accepts choiceIndex = choices.length - 1 (last choice)", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("ci-last", 1), TS_DURING, noop, alwaysValid);
    expect(getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0)).toBe(before + 1);
  });

  it("rejects choiceIndex = choices.length (out of bounds)", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("ci-oob", 2), TS_DURING, noop, alwaysValid);
    expect(getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0)).toBe(before);
  });

  it("rejects negative choiceIndex", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("ci-neg", -1), TS_DURING, noop, alwaysValid);
    expect(getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0)).toBe(before);
  });
});

// ── vote — other rejections ──────────────────────────────────────────────────

describe("handleMessage — other vote rejections", () => {
  it("rejects a vote for an unknown poll", async () => {
    const msg = { ...makeVote("rej-unknown"), pollTopicId: "0.0.9999" };
    // Should not throw — just log and return
    await expect(
      handleMessage("0.0.9999", msg, TS_DURING, noop, alwaysValid)
    ).resolves.toBeUndefined();
  });

  it("rejects a vote with an invalid ZK proof", async () => {
    const before = getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);
    await handleMessage(POLL_TOPIC, makeVote("rej-proof"), TS_DURING, noop, alwaysInvalid);
    expect(getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0)).toBe(before);
  });
});

// ── vote — credential path binding (F3 for vote_with_credential) ──────────────
// The vote_with_credential circuit has 5 public signals:
//   [0] merkleRoot, [1] nullifierHash, [2] choiceIndex,
//   [3] credentialMerkleRoot, [4] credentialNullifier
// The envelope must be bound to publicSignals for the credential fields too,
// otherwise a valid proof against a *different* credential set ([3]) could be
// counted, or the dedup credentialNullifier ([4]) could be swapped.

describe("handleMessage — credential path binding (F3)", () => {
  const CRED_TOPIC = "0.0.6002";
  const CRED_ROOT = "888"; // idosConfig.credentialMerkleRoot

  const total = () => getTally(CRED_TOPIC).reduce((s, r) => s + r.count, 0);

  beforeAll(() => {
    insertPoll({
      topicId: CRED_TOPIC,
      title: "Credential Poll",
      choices: ["Yes", "No"],
      tokenId: "0.0.802",
      merkleRoot: "777",
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      idosConfig: {
        issuerId: "issuer-1",
        credentialType: "KYCCredential",
        credentialMerkleRoot: CRED_ROOT,
      },
      credentialIds: ["c1", "c2"],
    });
  });

  /** A well-formed credential vote; override fields to construct mismatches. */
  function makeCredentialVote(
    nullifier: string,
    credentialNullifier: string,
    overrides: { credRoot?: string; sig4?: string } = {}
  ) {
    return {
      type: "vote" as const,
      pollTopicId: CRED_TOPIC,
      choiceIndex: 0,
      nullifier,
      credentialNullifier,
      proof: fakeProof,
      publicSignals: [
        "777",                              // [0] merkleRoot
        nullifier,                          // [1] nullifierHash
        "0",                                // [2] choiceIndex
        overrides.credRoot ?? CRED_ROOT,    // [3] credentialMerkleRoot
        overrides.sig4 ?? credentialNullifier, // [4] credentialNullifier
      ],
    };
  }

  it("rejects when publicSignals[3] != idosConfig.credentialMerkleRoot", async () => {
    const before = total();
    const vote = makeCredentialVote("cp-null-1", "cp-cred-1", { credRoot: "999" });
    await handleMessage(CRED_TOPIC, vote, TS_DURING, noop, alwaysValid, alwaysValid);
    expect(total()).toBe(before);
  });

  it("rejects when envelope credentialNullifier != publicSignals[4]", async () => {
    const before = total();
    const vote = makeCredentialVote("cp-null-2", "cp-cred-2", { sig4: "cp-other-cred" });
    await handleMessage(CRED_TOPIC, vote, TS_DURING, noop, alwaysValid, alwaysValid);
    expect(total()).toBe(before);
  });

  it("accepts a well-formed credential vote", async () => {
    const before = total();
    const vote = makeCredentialVote("cp-null-3", "cp-cred-3");
    await handleMessage(CRED_TOPIC, vote, TS_DURING, noop, alwaysValid, alwaysValid);
    expect(total()).toBe(before + 1);
  });

  it("rejects a credential vote with an invalid credential proof", async () => {
    // Exercises the verifyCredential(false) path — the credential-path analogue
    // of the base "invalid ZK proof" test.
    const before = total();
    const vote = makeCredentialVote("cp-null-4", "cp-cred-4");
    await handleMessage(CRED_TOPIC, vote, TS_DURING, noop, alwaysValid, alwaysInvalid);
    expect(total()).toBe(before);
  });
});

// ── vote — publicSignals binding (F3) ────────────────────────────────────────
// The trusted envelope fields (nullifier, choiceIndex) and the target merkleRoot
// must equal what the proof actually proves, otherwise a single valid proof can be
// replayed with a fresh nullifier (multi-count) or a different choiceIndex (miscount).

describe("handleMessage — publicSignals binding (F3)", () => {
  const total = () => getTally(POLL_TOPIC).reduce((s, r) => s + r.count, 0);

  it("rejects when envelope nullifier != publicSignals[1]", async () => {
    const before = total();
    const msg = {
      type: "vote" as const,
      pollTopicId: POLL_TOPIC,
      choiceIndex: 0,
      nullifier: "f3-envelope-null",              // envelope value
      proof: fakeProof,
      publicSignals: ["777", "f3-proven-null", "0"], // proof proves a different nullifier
    };
    await handleMessage(POLL_TOPIC, msg, TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before);
  });

  it("rejects when envelope choiceIndex != publicSignals[2]", async () => {
    const before = total();
    const msg = {
      type: "vote" as const,
      pollTopicId: POLL_TOPIC,
      choiceIndex: 1,                              // envelope says choice 1
      nullifier: "f3-choice",
      proof: fakeProof,
      publicSignals: ["777", "f3-choice", "0"],    // proof proves choice 0
    };
    await handleMessage(POLL_TOPIC, msg, TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before);
  });

  it("rejects when publicSignals[0] (root) != poll merkleRoot", async () => {
    const before = total();
    const msg = {
      type: "vote" as const,
      pollTopicId: POLL_TOPIC,
      choiceIndex: 0,
      nullifier: "f3-root",
      proof: fakeProof,
      publicSignals: ["999", "f3-root", "0"],      // proof is against a different root
    };
    await handleMessage(POLL_TOPIC, msg, TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before);
  });

  it("accepts when envelope matches publicSignals", async () => {
    const before = total();
    await handleMessage(POLL_TOPIC, makeVote("f3-ok", 0), TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before + 1);
  });
});
