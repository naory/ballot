/**
 * Tests for computeTally — aggregate votes from DB into a Tally object.
 */

import { describe, it, expect } from "vitest";

process.env.DB_PATH = ":memory:";

const { insertPoll, insertVote } = await import("./db.js");
const { computeTally } = await import("./tally.js");

const basePoll = {
  topicId: "0.0.3001",
  title: "Tally Test Poll",
  choices: ["A", "B", "C"],
  tokenId: "0.0.600",
  merkleRoot: "999",
  startsAt: "2026-04-01T00:00:00.000Z",
  endsAt: "2026-04-08T00:00:00.000Z",
};

describe("computeTally", () => {
  it("returns zero votes for a new poll", () => {
    insertPoll(basePoll);
    const tally = computeTally("0.0.3001");
    expect(tally.topicId).toBe("0.0.3001");
    expect(tally.totalVotes).toBe(0);
    expect(tally.counts).toEqual({});
  });

  it("counts votes per choice correctly", () => {
    insertVote({ topicId: "0.0.3001", choiceIndex: 0, nullifier: "t-n1", proof: "{}", publicSignals: [] });
    insertVote({ topicId: "0.0.3001", choiceIndex: 0, nullifier: "t-n2", proof: "{}", publicSignals: [] });
    insertVote({ topicId: "0.0.3001", choiceIndex: 1, nullifier: "t-n3", proof: "{}", publicSignals: [] });

    const tally = computeTally("0.0.3001");
    expect(tally.totalVotes).toBe(3);
    expect(tally.counts[0]).toBe(2);
    expect(tally.counts[1]).toBe(1);
    expect(tally.counts[2]).toBeUndefined();
  });

  it("nullifier set is always empty (populated at query time per design)", () => {
    const tally = computeTally("0.0.3001");
    expect(tally.nullifiers.size).toBe(0);
  });

  it("returns correct tally for unknown topicId (no rows)", () => {
    const tally = computeTally("0.0.9999");
    expect(tally.totalVotes).toBe(0);
    expect(tally.counts).toEqual({});
  });
});
