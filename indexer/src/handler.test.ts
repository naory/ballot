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
const { insertPoll, getTally } = await import("./db.js");

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
