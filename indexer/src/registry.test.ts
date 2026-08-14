import { describe, it, expect, beforeAll } from "vitest";
import { PrivateKey } from "@hashgraph/sdk";
import { registrationMessage } from "@ballot/core";

process.env.DB_PATH = ":memory:";
const { verifyRegistration } = await import("./registry.js");

const key = PrivateKey.generateED25519();
const pub = key.publicKey.toStringDer();
const ACCOUNT = "0.0.4242";
const COMMIT = "12345";

function sign(msg: string): string {
  return Buffer.from(key.sign(Buffer.from(msg, "utf-8"))).toString("hex");
}

const lookup = async (id: string) => (id === ACCOUNT ? pub : null);

describe("verifyRegistration", () => {
  it("accepts a valid signature by the account key", async () => {
    const sig = sign(registrationMessage(ACCOUNT, COMMIT));
    expect(await verifyRegistration({ type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: sig }, lookup)).toBe(true);
  });
  it("rejects a signature over a different commitment", async () => {
    const sig = sign(registrationMessage(ACCOUNT, "999"));
    expect(await verifyRegistration({ type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: sig }, lookup)).toBe(false);
  });
  it("rejects when the account key is unknown", async () => {
    const sig = sign(registrationMessage("0.0.1", COMMIT));
    expect(await verifyRegistration({ type: "register", accountId: "0.0.1", commitment: COMMIT, signature: sig }, lookup)).toBe(false);
  });
  it("rejects a malformed signature", async () => {
    expect(await verifyRegistration({ type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: "zz" }, lookup)).toBe(false);
  });
});
