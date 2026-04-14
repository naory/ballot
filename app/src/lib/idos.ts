/**
 * idOS SDK wrapper — fetches credential data needed to generate a
 * vote_with_credential ZK proof.
 *
 * idOS stores W3C Verifiable Credentials for users but does NOT provide ZK
 * primitives. This module retrieves the credential ID so the app can:
 *   1. Fetch the credential Merkle proof from the indexer
 *   2. Generate a ZK proof that includes credential membership
 *
 * The user's "credentialSecret" is a local secret (never sent to idOS) that
 * they use to compute the credential nullifier: Poseidon(credentialId, credentialSecret).
 * The app derives it from the wallet signature over a deterministic message.
 */

import type { IdosConfig } from "@ballot/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdosCredentialResult {
  /** Credential ID from the idOS store */
  credentialId: string;
  /**
   * Credential secret derived from a wallet signature over a deterministic
   * message. Used to compute the credential nullifier — never sent to idOS.
   */
  credentialSecret: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve the credential ID for the current user matching the poll's idOS
 * configuration.
 *
 * In production: integrate with `@idos-network/idos-sdk` to authenticate the
 * user's wallet with idOS and query their credentials by type and issuer.
 *
 * Current implementation provides the interface shape and stub for integration.
 *
 * @param idosConfig   - idOS configuration from the poll
 * @param walletSign   - Callback to request a wallet signature (for deriving the secret)
 * @returns            - credentialId and credentialSecret, or null if not found
 */
export async function getCredentialForPoll(
  idosConfig: IdosConfig,
  walletSign: (message: string) => Promise<string>
): Promise<IdosCredentialResult | null> {
  // ── Step 1: Authenticate with idOS ────────────────────────────────────────
  // In production: initialise the idOS SDK, connect the user's wallet, and
  // query credentials matching idosConfig.issuerId and idosConfig.credentialType.
  //
  // Example (not yet wired — requires @idos-network/idos-sdk):
  //
  //   import { idOS } from "@idos-network/idos-sdk";
  //   const sdk = await idOS.init({ nodeUrl: "https://nodes.idos.network" });
  //   await sdk.auth.setEvmSigner(signer);
  //   const credentials = await sdk.data.list("credentials");
  //   const match = credentials.find(
  //     (c) => c.issuer === idosConfig.issuerId && c.credential_type === idosConfig.credentialType
  //   );
  //   if (!match) return null;
  //   const credentialId = match.id;

  // ── Stub: In tests / development, accept an env-provided credential ID ────
  const credentialId = process.env.NEXT_PUBLIC_DEV_CREDENTIAL_ID ?? null;
  if (!credentialId) {
    console.warn("[idos] No credential found. Set NEXT_PUBLIC_DEV_CREDENTIAL_ID for dev mode.");
    return null;
  }

  // ── Step 2: Derive credentialSecret from wallet signature ─────────────────
  // The secret is deterministic given the wallet key so the user can always
  // reproduce the same nullifier without storing it separately.
  const message = `ballot-credential-secret:${credentialId}`;
  const signature = await walletSign(message);

  // Use the first 31 bytes of the signature as a field-element-safe secret.
  // Groth16 field prime is ~254 bits; 31 bytes = 248 bits — always in range.
  const sigBytes = hexToBytes(signature.replace(/^0x/, ""));
  const credentialSecret = BigInt(
    "0x" + Array.from(sigBytes.slice(0, 31))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  ).toString();

  return { credentialId, credentialSecret };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
