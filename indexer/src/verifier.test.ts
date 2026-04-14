/**
 * Tests for verifyVoteProof — snarkjs Groth16 verification wrapper.
 *
 * snarkjs and node:fs are fully mocked so no compiled circuit artifacts are needed.
 * The vkey cache in verifier.ts is module-level; isolation comes from Vitest's
 * default forks pool giving each test file its own module registry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZKProof } from "@ballot/core";

// Must start with "mock" so Vitest allows it in the factory despite hoisting
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

// Set env before the module initialises (first getVerificationKey() call)
process.env.VKEY_PATH = "/test/fake.vkey.json";

const { verifyVoteProof } = await import("./verifier.js");

const proof: ZKProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [["1", "2"], ["3", "4"], ["1", "0"]],
  pi_c: ["5", "6", "1"],
  protocol: "groth16",
  curve: "bn128",
};
const publicSignals = ["merkleRoot111", "nullifier222", "1"];

describe("verifyVoteProof", () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  it("returns true when snarkjs verifies the proof", async () => {
    mockVerify.mockResolvedValue(true);

    const result = await verifyVoteProof(proof, publicSignals);

    expect(result).toBe(true);
    expect(mockVerify).toHaveBeenCalledOnce();
    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "groth16" }), // vkey (from mocked readFileSync)
      publicSignals,
      proof
    );
  });

  it("returns false when the proof does not verify", async () => {
    mockVerify.mockResolvedValue(false);

    expect(await verifyVoteProof(proof, publicSignals)).toBe(false);
  });

  it("returns false (does not throw) when snarkjs throws", async () => {
    mockVerify.mockRejectedValue(new Error("malformed proof bytes"));

    expect(await verifyVoteProof(proof, publicSignals)).toBe(false);
  });

  it("passes proof and public signals through to snarkjs unchanged", async () => {
    mockVerify.mockResolvedValue(true);
    const signals = ["aaa", "bbb", "0"];

    await verifyVoteProof(proof, signals);

    expect(mockVerify).toHaveBeenCalledWith(expect.anything(), signals, proof);
  });
});
