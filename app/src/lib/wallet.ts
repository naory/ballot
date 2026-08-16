import type { Client } from "@hashgraph/sdk";

/** A connected Hedera wallet the app can sign/submit with. */
export interface WalletSigner {
  accountId: string;
  /** Sign a UTF-8 message with the account's Hedera key; returns hex. */
  signMessage: (message: string) => Promise<string>;
  /** Client used to submit HCS messages (registration, votes). */
  client: Client;
}

/**
 * Returns the connected wallet, or null if none is connected.
 * Placeholder: real wallet integration (HashConnect / embedded wallet,
 * DESIGN.md Decision 3) implements this. Until then it returns null and the
 * UI shows a "connect a wallet" state — no signing is faked.
 */
export function getWalletSigner(): WalletSigner | null {
  return null;
}
