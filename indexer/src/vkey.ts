/**
 * Verification-key loading (F8).
 *
 * Centralizes how the indexer locates and reads Groth16 verification keys so a
 * missing/unreadable key produces a clear, actionable error instead of being
 * silently swallowed and reported as "invalid proof" for every vote.
 */

import fs from "node:fs";
import path from "node:path";

/** Thrown when a verification key can't be read — a config/deploy problem, not a bad proof. */
export class VerificationKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationKeyUnavailableError";
  }
}

/** Resolved path to the base `vote` circuit verification key. */
export function voteVkeyPath(): string {
  return (
    process.env.VKEY_PATH ||
    path.join(process.cwd(), "..", "circuits", "build", "vote_v2.vkey.json")
  );
}

/** Resolved path to the `vote_with_credential` circuit verification key. */
export function credentialVkeyPath(): string {
  return (
    process.env.CREDENTIAL_VKEY_PATH ||
    path.join(process.cwd(), "..", "circuits", "build", "vote_with_credential.vkey.json")
  );
}

/**
 * Read and parse a verification key from disk. Throws
 * {@link VerificationKeyUnavailableError} with an actionable message when the
 * file is missing or not valid JSON.
 */
export function loadVkey(vkeyPath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(vkeyPath, "utf-8");
  } catch {
    throw new VerificationKeyUnavailableError(
      `Verification key not found at ${vkeyPath}. Run the circuit setup ` +
        `(cd circuits && npm run setup) and/or set VKEY_PATH / CREDENTIAL_VKEY_PATH.`
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new VerificationKeyUnavailableError(
      `Verification key at ${vkeyPath} is not valid JSON.`
    );
  }
}
