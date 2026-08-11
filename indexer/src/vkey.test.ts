import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadVkey, VerificationKeyUnavailableError } from "./vkey.js";

let dir: string;
let goodPath: string;
let badPath: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ballot-vkey-"));
  goodPath = path.join(dir, "good.vkey.json");
  badPath = path.join(dir, "bad.vkey.json");
  fs.writeFileSync(goodPath, JSON.stringify({ protocol: "groth16", curve: "bn128" }));
  fs.writeFileSync(badPath, "{ not valid json");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadVkey", () => {
  it("loads and parses an existing verification key", () => {
    expect(loadVkey(goodPath)).toMatchObject({ protocol: "groth16", curve: "bn128" });
  });

  it("throws VerificationKeyUnavailableError when the file is missing", () => {
    expect(() => loadVkey(path.join(dir, "missing.vkey.json"))).toThrow(
      VerificationKeyUnavailableError
    );
  });

  it("throws VerificationKeyUnavailableError when the file is not valid JSON", () => {
    expect(() => loadVkey(badPath)).toThrow(VerificationKeyUnavailableError);
  });
});
