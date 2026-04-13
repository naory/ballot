/**
 * snarkjs wrapper — client-side ZK proof generation.
 *
 * Generates a Groth16 proof that the user:
 *   1. Holds an NFT serial in the eligible Merkle set
 *   2. Has a unique nullifier (prevents double-voting)
 *   3. Voted for a valid choice index
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
import { poseidon2 } from "poseidon-lite";
import type { ZKProof } from "@ballot/core";

interface ProofInput {
  merkleRoot: string;
  serial: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  choiceIndex: number;
}

interface ProofResult {
  proof: ZKProof;
  publicSignals: string[];
  /** Poseidon(serial, secret) — submit this alongside the proof so the indexer can deduplicate */
  nullifier: string;
}

/**
 * Generate a ZK vote proof client-side.
 *
 * Requires compiled circuit artifacts to be served as static assets:
 *   /circuits/vote_js/vote.wasm  — circuit WASM
 *   /circuits/vote_final.zkey    — Groth16 proving key
 *
 * Run `circuits/scripts/compile.sh` then `circuits/scripts/setup.sh` to produce them,
 * then copy the outputs into `app/public/circuits/`.
 */
export async function generateVoteProof(
  input: ProofInput
): Promise<ProofResult> {
  const wasmPath = "/circuits/vote_js/vote.wasm";
  const zkeyPath = "/circuits/vote_final.zkey";

  // Pre-compute nullifier = Poseidon(serial, secret) so the circuit can verify it.
  // The circuit constraints: Poseidon(serial, secret) === nullifierHash (public input).
  const nullifier = poseidon2([BigInt(input.serial), BigInt(input.secret)]).toString();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      merkleRoot:    input.merkleRoot,
      nullifierHash: nullifier,
      choiceIndex:   input.choiceIndex,
      serial:        input.serial,
      secret:        input.secret,
      pathElements:  input.pathElements,
      pathIndices:   input.pathIndices,
    },
    wasmPath,
    zkeyPath
  );

  // Public signal ordering matches circuit declaration: [merkleRoot, nullifierHash, choiceIndex]
  return {
    proof: proof as ZKProof,
    publicSignals: publicSignals as string[],
    nullifier,
  };
}

/** Verify a proof client-side (for testing / immediate UI feedback before HCS submission) */
export async function verifyProof(
  proof: ZKProof,
  publicSignals: string[]
): Promise<boolean> {
  const vkeyRes = await fetch("/circuits/vote.vkey.json");
  const vkey = await vkeyRes.json();
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
