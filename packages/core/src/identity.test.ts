import { describe, it, expect } from "vitest";
import { poseidon1, poseidon2 } from "poseidon-lite";
import {
  FIELD_ORDER,
  deriveIdentitySecret,
  identityCommitment,
  voteNullifier,
  pollIdFromTopic,
  registrationMessage,
} from "./identity.js";

const seed = new Uint8Array(32).fill(7);

describe("deriveIdentitySecret", () => {
  it("is deterministic and in-field", () => {
    const a = deriveIdentitySecret(seed);
    const b = deriveIdentitySecret(new Uint8Array(32).fill(7));
    expect(a).toBe(b);
    expect(a < FIELD_ORDER).toBe(true);
  });
  it("differs for different seeds", () => {
    expect(deriveIdentitySecret(seed)).not.toBe(
      deriveIdentitySecret(new Uint8Array(32).fill(8))
    );
  });
});

describe("identityCommitment / voteNullifier", () => {
  it("commitment = Poseidon([secret])", () => {
    const s = deriveIdentitySecret(seed);
    expect(identityCommitment(s)).toBe(poseidon1([s]));
  });
  it("nullifier = Poseidon([secret, pollId]) and binds pollId", () => {
    const s = deriveIdentitySecret(seed);
    expect(voteNullifier(s, 5n)).toBe(poseidon2([s, 5n]));
    expect(voteNullifier(s, 5n)).not.toBe(voteNullifier(s, 6n));
  });
});

describe("pollIdFromTopic", () => {
  it("returns the numeric tail for 0.0.x", () => {
    expect(pollIdFromTopic("0.0.12345")).toBe(12345n);
  });
  it("throws on non-0.0.x", () => {
    expect(() => pollIdFromTopic("1.2.3")).toThrow();
  });
});

describe("registrationMessage", () => {
  it("is domain-separated and includes account + commitment", () => {
    expect(registrationMessage("0.0.9", "42")).toBe("ballot-register-v1:0.0.9:42");
  });
});
