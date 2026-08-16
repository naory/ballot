/**
 * Identity layer (F1/F2). Minimal impl: a random seed persisted in browser
 * storage; the embedded-wallet provider (Decision 3) replaces this behind the
 * same interface later. Recovery/MPC deferred.
 */
import { deriveIdentitySecret, identityCommitment, registrationMessage } from "@ballot/core";

export interface IdentityProvider {
  getIdentitySecret(): Promise<bigint>;
  getCommitment(): Promise<string>;
  signRegistration(): Promise<{ accountId: string; commitment: string; signature: string }>;
}

const SEED_KEY = "ballot_identity_seed_v1";

function loadOrCreateSeed(): Uint8Array {
  const stored = localStorage.getItem(SEED_KEY);
  if (stored) return Uint8Array.from(stored.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const seed = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SEED_KEY, Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join(""));
  return seed;
}

/**
 * @param accountId  the voter's Hedera account
 * @param signMessage signs a UTF-8 message with the account's Hedera key, returns hex signature
 */
export function getIdentityProvider(
  accountId: string,
  signMessage: (msg: string) => Promise<string>
): IdentityProvider {
  const secret = deriveIdentitySecret(loadOrCreateSeed());
  const commitment = identityCommitment(secret).toString();
  return {
    async getIdentitySecret() {
      return secret;
    },
    async getCommitment() {
      return commitment;
    },
    async signRegistration() {
      const signature = await signMessage(registrationMessage(accountId, commitment));
      return { accountId, commitment, signature };
    },
  };
}
