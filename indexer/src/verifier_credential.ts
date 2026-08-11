/**
 * ZK proof verification for vote_with_credential circuit.
 * Used when a poll has idosConfig — voters must prove both NFT membership
 * and valid idOS credential ownership.
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
import type { ZKProof } from "@ballot/core";
import { loadVkey, credentialVkeyPath, VerificationKeyUnavailableError } from "./vkey.js";

let vkey: unknown = null;

/** Load the credential circuit verification key (cached after first load). */
function getVerificationKey(): unknown {
  if (!vkey) vkey = loadVkey(credentialVkeyPath());
  return vkey;
}

/** Verify a ZK vote_with_credential proof. Returns false for invalid proofs and config errors. */
export async function verifyCredentialVoteProof(
  proof: ZKProof,
  publicSignals: string[]
): Promise<boolean> {
  let vk: unknown;
  try {
    vk = getVerificationKey();
  } catch (err) {
    if (err instanceof VerificationKeyUnavailableError) {
      console.error(
        `[verifier_credential] ${err.message} Rejecting all credential votes until resolved.`
      );
    } else {
      console.error("[verifier_credential] Failed to load verification key:", err);
    }
    return false;
  }

  try {
    return await snarkjs.groth16.verify(vk, publicSignals, proof);
  } catch (err) {
    console.warn(
      "[verifier_credential] Proof rejected:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
