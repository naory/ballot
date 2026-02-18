/**
 * snarkjs wrapper — client-side ZK proof generation.
 *
 * Generates a Groth16 proof that the user holds an NFT in the eligible set
 * and commits to a specific vote choice.
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
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
  nullifier: string;
}

/**
 * Generate a ZK vote proof client-side.
 *
 * Requires the compiled circuit WASM and proving key (zkey) to be
 * served as static assets under /circuits/.
 */
export async function generateVoteProof(
  input: ProofInput
): Promise<ProofResult> {
  const wasmPath = "/circuits/vote_js/vote.wasm";
  const zkeyPath = "/circuits/vote_final.zkey";

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      merkleRoot: input.merkleRoot,
      serial: input.serial,
      secret: input.secret,
      pathElements: input.pathElements,
      pathIndices: input.pathIndices,
      choiceIndex: input.choiceIndex,
      nullifierHash: "0", // placeholder — circuit computes this
    },
    wasmPath,
    zkeyPath
  );

  return {
    proof: proof as ZKProof,
    publicSignals: publicSignals as string[],
    nullifier: publicSignals[1], // index depends on circuit output ordering
  };
}

/** Verify a proof client-side (for testing / UI feedback) */
export async function verifyProof(
  proof: ZKProof,
  publicSignals: string[]
): Promise<boolean> {
  const vkeyRes = await fetch("/circuits/vote.vkey.json");
  const vkey = await vkeyRes.json();
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
