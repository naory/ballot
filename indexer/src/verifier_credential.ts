/**
 * ZK proof verification for vote_with_credential circuit.
 * Used when a poll has idosConfig — voters must prove both NFT membership
 * and valid idOS credential ownership.
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
import fs from "node:fs";
import path from "node:path";
import type { ZKProof } from "@ballot/core";

let vkey: unknown = null;

/** Load the credential circuit verification key (cached after first load) */
function getVerificationKey(): unknown {
  if (!vkey) {
    const vkeyPath =
      process.env.CREDENTIAL_VKEY_PATH ||
      path.join(process.cwd(), "..", "circuits", "build", "vote_with_credential.vkey.json");
    vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));
  }
  return vkey;
}

/** Verify a ZK vote_with_credential proof */
export async function verifyCredentialVoteProof(
  proof: ZKProof,
  publicSignals: string[]
): Promise<boolean> {
  try {
    const vk = getVerificationKey();
    return await snarkjs.groth16.verify(vk, publicSignals, proof);
  } catch (err) {
    console.error("[verifier_credential] Proof verification failed:", err);
    return false;
  }
}
