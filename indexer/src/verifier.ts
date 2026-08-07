/**
 * ZK proof verification using snarkjs.
 * Verifies Groth16 proofs server-side before counting votes.
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
import type { ZKProof } from "@ballot/core";
import { loadVkey, voteVkeyPath, VerificationKeyUnavailableError } from "./vkey.js";

let vkey: unknown = null;

/** Load the verification key (cached after first load). */
function getVerificationKey(): unknown {
  if (!vkey) vkey = loadVkey(voteVkeyPath());
  return vkey;
}

/** Verify a ZK vote proof. Returns false for both invalid proofs and config errors. */
export async function verifyVoteProof(
  proof: ZKProof,
  publicSignals: string[]
): Promise<boolean> {
  let vk: unknown;
  try {
    vk = getVerificationKey();
  } catch (err) {
    // Config/deploy problem — surfaced distinctly so it isn't mistaken for a bad proof.
    if (err instanceof VerificationKeyUnavailableError) {
      console.error(`[verifier] ${err.message} Rejecting all votes until resolved.`);
    } else {
      console.error("[verifier] Failed to load verification key:", err);
    }
    return false;
  }

  try {
    return await snarkjs.groth16.verify(vk, publicSignals, proof);
  } catch (err) {
    console.warn(
      "[verifier] Proof rejected:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
