/**
 * Identity crypto for ownership-proof voting (F1/F2).
 * Pure, poseidon-lite only — shared by app, indexer, and circuit tests.
 */
import { poseidon1, poseidon2 } from "poseidon-lite";

/** BN254 scalar field order — all field elements must be < this. */
export const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Domain tag separating identity-secret derivation from other hashes. */
const IDENTITY_DOMAIN = 1n;

function bytesToField(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc % FIELD_ORDER;
}

/** Deterministic identity secret from a 32-byte seed. */
export function deriveIdentitySecret(seed: Uint8Array): bigint {
  return poseidon2([IDENTITY_DOMAIN, bytesToField(seed)]);
}

/** Public identity commitment = Poseidon([secret]). */
export function identityCommitment(secret: bigint): bigint {
  return poseidon1([secret]);
}

/** Per-poll nullifier = Poseidon([secret, pollId]) — deterministic, one per identity per poll. */
export function voteNullifier(secret: bigint, pollId: bigint): bigint {
  return poseidon2([secret, pollId]);
}

/**
 * Derive a field-element poll id from a Hedera topic id.
 * Assumes user topics are "0.0.<num>"; throws otherwise.
 */
export function pollIdFromTopic(topicId: string): bigint {
  const m = /^0\.0\.(\d+)$/.exec(topicId.trim());
  if (!m) throw new Error(`Unsupported topic id for pollId: ${topicId} (expected 0.0.<num>)`);
  return BigInt(m[1]);
}

/** Canonical message a holder signs (Hedera key) to register their commitment. */
export function registrationMessage(accountId: string, commitment: string): string {
  return `ballot-register-v1:${accountId}:${commitment}`;
}
