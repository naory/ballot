/**
 * ZK proof verification using snarkjs.
 * Verifies Groth16 proofs server-side before counting votes.
 */

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from "snarkjs";
import fs from "node:fs";
import path from "node:path";
import type { ZKProof } from "@ballot/core";

let vkey: unknown = null;

/** Load the verification key (cached after first load) */
function getVerificationKey(): unknown {
  if (!vkey) {
    const vkeyPath =
      process.env.VKEY_PATH ||
      path.join(process.cwd(), "..", "circuits", "build", "vote.vkey.json");
    vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));
  }
  return vkey;
}

/** Verify a ZK vote proof */
export async function verifyVoteProof(
  proof: ZKProof,
  publicSignals: string[]
): Promise<boolean> {
  try {
    const vk = getVerificationKey();
    return await snarkjs.groth16.verify(vk, publicSignals, proof);
  } catch (err) {
    console.error("[verifier] Proof verification failed:", err);
    return false;
  }
}
