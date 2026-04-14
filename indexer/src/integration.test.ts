/**
 * Integration tests for the vote-processing pipeline:
 *   verifyVoteProof → insertVote → computeTally
 *
 * This mirrors what the HCS message handler in index.ts does for each incoming vote:
 *   1. Verify the ZK proof (reject invalid proofs before touching the DB)
 *   2. Insert the vote, keyed on nullifier (reject duplicates)
 *   3. Reflect the result in the tally
 *
 * snarkjs is mocked — no compiled circuit artifacts needed.
 * DB uses in-memory SQLite.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import type { ZKProof } from "@ballot/core";

process.env.DB_PATH = ":memory:";
process.env.VKEY_PATH = "/test/fake.vkey.json";

const mockVerify = vi.fn<[unknown, string[], ZKProof], Promise<boolean>>();

vi.mock("snarkjs", () => ({
  groth16: { verify: mockVerify },
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() =>
      JSON.stringify({ protocol: "groth16", curve: "bn128" })
    ),
  },
}));

const { verifyVoteProof } = await import("./verifier.js");
const { insertPoll, insertVote } = await import("./db.js");
const { computeTally } = await import("./tally.js");

const poll = {
  topicId: "0.0.5001",
  title: "Integration Poll",
  choices: ["Yes", "No"],
  tokenId: "0.0.700",
  merkleRoot: "555",
  startsAt: "2026-04-01T00:00:00.000Z",
  endsAt: "2026-04-08T00:00:00.000Z",
};

const proof: ZKProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [["1", "2"], ["3", "4"], ["1", "0"]],
  pi_c: ["5", "6", "1"],
  protocol: "groth16",
  curve: "bn128",
};

beforeAll(() => {
  insertPoll(poll);
});

// Simulates how index.ts processes an incoming HCS vote message
async function processVote(
  nullifier: string,
  choiceIndex: number,
  proofValid: boolean
): Promise<"counted" | "invalid_proof" | "duplicate"> {
  mockVerify.mockResolvedValueOnce(proofValid);

  const signals = [poll.merkleRoot, nullifier, String(choiceIndex)];
  const valid = await verifyVoteProof(proof, signals);
  if (!valid) return "invalid_proof";

  const inserted = insertVote({
    topicId: poll.topicId,
    choiceIndex,
    nullifier,
    proof: JSON.stringify(proof),
    publicSignals: signals,
  });
  return inserted ? "counted" : "duplicate";
}

describe("vote pipeline: verifyVoteProof → insertVote → computeTally", () => {
  it("valid proof increments the tally for the chosen option", async () => {
    expect(await processVote("nl-valid-1", 0, true)).toBe("counted");

    const tally = computeTally(poll.topicId);
    expect(tally.totalVotes).toBeGreaterThanOrEqual(1);
    expect(tally.counts[0]).toBeGreaterThanOrEqual(1);
  });

  it("invalid proof is dropped — tally does not change", async () => {
    const before = computeTally(poll.topicId).totalVotes;

    expect(await processVote("nl-invalid-1", 0, false)).toBe("invalid_proof");

    expect(computeTally(poll.topicId).totalVotes).toBe(before);
  });

  it("duplicate nullifier is rejected even when proof is valid", async () => {
    // First vote succeeds
    expect(await processVote("nl-dup-1", 0, true)).toBe("counted");
    const after = computeTally(poll.topicId).totalVotes;

    // Same nullifier, different choice — blocked by UNIQUE constraint
    expect(await processVote("nl-dup-1", 1, true)).toBe("duplicate");
    expect(computeTally(poll.topicId).totalVotes).toBe(after);
  });

  it("multiple valid votes from different nullifiers all count", async () => {
    const before = computeTally(poll.topicId).totalVotes;

    await processVote("nl-multi-a", 0, true);
    await processVote("nl-multi-b", 1, true);
    await processVote("nl-multi-c", 0, true);

    const tally = computeTally(poll.topicId);
    expect(tally.totalVotes).toBe(before + 3);
  });
});
