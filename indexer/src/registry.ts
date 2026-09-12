/**
 * Registration verification (F1): binds a Hedera account to an identity
 * commitment. A registration is valid only if signed by the account's key.
 */
import { PublicKey } from "@hashgraph/sdk";
import { registrationMessage } from "@ballot/core";
import type { HCSRegisterMessage } from "@ballot/core";
import { upsertRegistration } from "./db.js";

const MIRROR_BASE =
  process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";

/** Fetch an account's Ed25519 public key (DER/hex) from Mirror Node. */
export async function fetchAccountKey(accountId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { key?: { key?: string } };
    return data.key?.key ?? null;
  } catch {
    return null;
  }
}

/** Verify a registration's signature against the account's on-file key. */
export async function verifyRegistration(
  msg: HCSRegisterMessage,
  accountKeyLookup: (id: string) => Promise<string | null> = fetchAccountKey
): Promise<boolean> {
  try {
    const keyStr = await accountKeyLookup(msg.accountId);
    if (!keyStr) return false;
    const pub = PublicKey.fromString(keyStr);
    const message = Buffer.from(registrationMessage(msg.accountId, msg.commitment), "utf-8");
    const sig = Buffer.from(msg.signature, "hex");
    return pub.verify(message, sig);
  } catch {
    return false;
  }
}

/** Verify then record a registration (latest-wins on consensus timestamp). */
export async function handleRegister(
  msg: HCSRegisterMessage,
  timestamp: string,
  accountKeyLookup: (id: string) => Promise<string | null> = fetchAccountKey
): Promise<void> {
  if (!(await verifyRegistration(msg, accountKeyLookup))) {
    console.warn(`[registry] Rejected registration for ${msg.accountId} (bad signature or unknown key)`);
    return;
  }
  upsertRegistration({ accountId: msg.accountId, commitment: msg.commitment, consensusTs: timestamp });
  console.log(`[registry] Registered ${msg.accountId} -> ${msg.commitment}`);
}
