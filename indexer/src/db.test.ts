/**
 * Tests for indexer DB operations (insertPoll, insertVote, getTally, getAllPolls, getPoll).
 * Uses an in-memory SQLite DB by setting DB_PATH=:memory: before the first getDb() call.
 *
 * Each test file gets its own fresh DB because vitest isolates modules per file by default
 * when using `pool: 'forks'` (the default). We reset between describe blocks by re-opening.
 */

import { beforeEach, describe, it, expect } from "vitest";

// Force in-memory DB for this test file before any module is imported
process.env.DB_PATH = ":memory:";

// Dynamic import so that DB_PATH is set before module initialisation
const { insertPoll, insertVote, getTally, getAllPolls, getPoll } = await import(
  "./db.js"
);

const basePoll = {
  topicId: "0.0.1001",
  title: "Test Poll",
  choices: ["Yes", "No"],
  tokenId: "0.0.500",
  merkleRoot: "123456789",
  startsAt: "2026-04-01T00:00:00.000Z",
  endsAt: "2026-04-08T00:00:00.000Z",
};

describe("insertPoll / getPoll / getAllPolls", () => {
  it("inserts a poll and retrieves it", () => {
    insertPoll(basePoll);
    const row = getPoll("0.0.1001") as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.title).toBe("Test Poll");
    expect(row.merkle_root).toBe("123456789");
  });

  it("stores serials as JSON and round-trips them", () => {
    insertPoll({ ...basePoll, topicId: "0.0.1002", serials: ["1", "2", "3"] });
    const row = getPoll("0.0.1002") as Record<string, unknown>;
    expect(JSON.parse(row.serials as string)).toEqual(["1", "2", "3"]);
  });

  it("stores description when provided", () => {
    insertPoll({ ...basePoll, topicId: "0.0.1003", description: "Desc here" });
    const row = getPoll("0.0.1003") as Record<string, unknown>;
    expect(row.description).toBe("Desc here");
  });

  it("description is null when omitted", () => {
    insertPoll({ ...basePoll, topicId: "0.0.1004" });
    const row = getPoll("0.0.1004") as Record<string, unknown>;
    expect(row.description).toBeNull();
  });

  it("INSERT OR IGNORE — duplicate topicId is a no-op", () => {
    insertPoll(basePoll); // already inserted above
    insertPoll({ ...basePoll, title: "Overwrite attempt" });
    const row = getPoll("0.0.1001") as Record<string, unknown>;
    expect(row.title).toBe("Test Poll"); // original value preserved
  });

  it("getAllPolls returns all inserted polls", () => {
    const rows = getAllPolls() as unknown[];
    // We inserted 0.0.1001 through 0.0.1004 above
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it("getPoll returns undefined for unknown topicId", () => {
    expect(getPoll("0.0.9999")).toBeUndefined();
  });
});

describe("insertVote / getTally", () => {
  beforeEach(() => {
    // Ensure poll 0.0.2001 exists for foreign key reference
    insertPoll({ ...basePoll, topicId: "0.0.2001" });
  });

  it("inserts a vote and reflects it in tally", () => {
    insertVote({
      topicId: "0.0.2001",
      choiceIndex: 0,
      nullifier: "nullifier-a",
      proof: "{}",
      publicSignals: ["1", "2"],
    });
    const tally = getTally("0.0.2001");
    expect(tally).toEqual([{ choiceIndex: 0, count: 1 }]);
  });

  it("returns true on successful insert", () => {
    const result = insertVote({
      topicId: "0.0.2001",
      choiceIndex: 1,
      nullifier: "nullifier-b",
      proof: "{}",
      publicSignals: [],
    });
    expect(result).toBe(true);
  });

  it("rejects duplicate nullifier (double-vote) and returns false", () => {
    insertVote({
      topicId: "0.0.2001",
      choiceIndex: 0,
      nullifier: "nullifier-dup",
      proof: "{}",
      publicSignals: [],
    });
    const second = insertVote({
      topicId: "0.0.2001",
      choiceIndex: 1,
      nullifier: "nullifier-dup", // same nullifier
      proof: "{}",
      publicSignals: [],
    });
    expect(second).toBe(false);
  });

  it("tally counts are per-choice", () => {
    insertVote({ topicId: "0.0.2001", choiceIndex: 0, nullifier: "n-c0-1", proof: "{}", publicSignals: [] });
    insertVote({ topicId: "0.0.2001", choiceIndex: 0, nullifier: "n-c0-2", proof: "{}", publicSignals: [] });
    insertVote({ topicId: "0.0.2001", choiceIndex: 1, nullifier: "n-c1-1", proof: "{}", publicSignals: [] });

    const tally = getTally("0.0.2001");
    const c0 = tally.find((r) => r.choiceIndex === 0);
    const c1 = tally.find((r) => r.choiceIndex === 1);
    // cumulative from all tests in this describe block — at least 2 for c0 and 1 for c1
    expect(c0!.count).toBeGreaterThanOrEqual(2);
    expect(c1!.count).toBeGreaterThanOrEqual(1);
  });

  it("tally is empty for a poll with no votes", () => {
    insertPoll({ ...basePoll, topicId: "0.0.2002" });
    expect(getTally("0.0.2002")).toEqual([]);
  });
});
