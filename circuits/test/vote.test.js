/**
 * Circuit tests for vote.circom.
 *
 * Uses circom_tester with pre-compiled artifacts (recompile: false).
 * Run `npm run compile && npm run setup` in circuits/ before these tests.
 *
 * Constraints tested:
 *   1. Valid proof — all constraints satisfied
 *   2. Wrong Merkle root — root mismatch → constraint failure
 *   3. Wrong nullifier — Poseidon(serial,secret) mismatch → constraint failure
 *   4. Tampered path element — root mismatch → constraint failure
 *   5. choiceIndex = 255 — valid (8-bit upper bound)
 *   6. choiceIndex = 256 — invalid (exceeds Num2Bits(8)) → constraint failure
 */

const path = require("path");
const assert = require("assert");
const { wasm: wasm_tester } = require("circom_tester");
const {
  buildFixedTree,
  getRoot,
  getMerkleProof,
  computeNullifier,
} = require("./helpers");

const CIRCUIT_PATH = path.join(__dirname, "../src/vote.circom");
const BUILD_DIR = path.join(__dirname, "../build");

// Test fixtures — shared across all tests
const SERIALS = ["1", "2", "3", "4", "5"];
const VOTER_SERIAL = "1"; // index 0
const VOTER_SECRET = "99999";

let circuit;
let layers;
let merkleRoot;
let pathElements;
let pathIndices;
let nullifier;

before(async function () {
  this.timeout(30_000);
  circuit = await wasm_tester(CIRCUIT_PATH, {
    output: BUILD_DIR,
    recompile: false,
  });

  layers = buildFixedTree(SERIALS);
  merkleRoot = getRoot(layers);
  ({ pathElements, pathIndices } = getMerkleProof(layers, 0)); // serial "1" is at index 0
  nullifier = computeNullifier(VOTER_SERIAL, VOTER_SECRET);
});

function validInput(overrides = {}) {
  return {
    merkleRoot,
    nullifierHash: nullifier,
    choiceIndex: 1,
    serial: BigInt(VOTER_SERIAL),
    secret: BigInt(VOTER_SECRET),
    pathElements,
    pathIndices,
    ...overrides,
  };
}

describe("vote.circom — valid proof", () => {
  it("passes all constraints for a well-formed vote", async function () {
    this.timeout(15_000);
    const w = await circuit.calculateWitness(validInput(), true);
    await circuit.checkConstraints(w);
  });
});

describe("vote.circom — Merkle membership constraint", () => {
  // In circom 2.x, the WASM witness calculator enforces === constraints
  // at witness-generation time (sanityCheck=true), throwing "Assert Failed".

  it("fails when merkleRoot does not match the computed root", async function () {
    this.timeout(15_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ merkleRoot: merkleRoot + 1n }), true),
      /Assert Failed/
    );
  });

  it("fails when a path element is tampered", async function () {
    this.timeout(15_000);
    const badPath = [...pathElements];
    badPath[0] = badPath[0] + 1n; // corrupt the first sibling
    await assert.rejects(
      circuit.calculateWitness(validInput({ pathElements: badPath }), true),
      /Assert Failed/
    );
  });

  it("fails when serial is not in the tree", async function () {
    this.timeout(15_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ serial: BigInt("9999") }), true),
      /Assert Failed/
    );
  });
});

describe("vote.circom — nullifier constraint", () => {
  it("fails when nullifierHash does not equal Poseidon(serial, secret)", async function () {
    this.timeout(15_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ nullifierHash: nullifier + 1n }), true),
      /Assert Failed/
    );
  });

  it("same serial + secret always produces the same nullifier (determinism)", async function () {
    this.timeout(15_000);
    const n1 = computeNullifier(VOTER_SERIAL, VOTER_SECRET);
    const n2 = computeNullifier(VOTER_SERIAL, VOTER_SECRET);
    assert.strictEqual(n1, n2);
  });

  it("different secrets produce different nullifiers", async function () {
    const n1 = computeNullifier(VOTER_SERIAL, "11111");
    const n2 = computeNullifier(VOTER_SERIAL, "22222");
    assert.notStrictEqual(n1, n2);
  });
});

describe("vote.circom — choiceIndex range constraint", () => {
  it("accepts choiceIndex = 0 (lower bound)", async function () {
    this.timeout(15_000);
    const w = await circuit.calculateWitness(validInput({ choiceIndex: 0 }), true);
    await circuit.checkConstraints(w);
  });

  it("accepts choiceIndex = 255 (8-bit upper bound)", async function () {
    this.timeout(15_000);
    const w = await circuit.calculateWitness(validInput({ choiceIndex: 255 }), true);
    await circuit.checkConstraints(w);
  });

  it("rejects choiceIndex = 256 (exceeds Num2Bits(8))", async function () {
    this.timeout(15_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ choiceIndex: 256 }), true),
      /Assert Failed/
    );
  });
});
