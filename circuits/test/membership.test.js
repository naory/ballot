/**
 * Circuit tests for membership.circom.
 *
 * Proves Merkle inclusion without revealing the serial (subset of vote.circom).
 * Tests are faster here since membership.circom is simpler (no nullifier/choice).
 */

const path = require("path");
const assert = require("assert");
const { wasm: wasm_tester } = require("circom_tester");
const { buildFixedTree, getRoot, getMerkleProof } = require("./helpers");

const CIRCUIT_PATH = path.join(__dirname, "../src/membership.circom");
const BUILD_DIR = path.join(__dirname, "../build");

const SERIALS = ["10", "20", "30"];

let circuit;
let layers;
let merkleRoot;
let pathElements;
let pathIndices;

before(async function () {
  this.timeout(30_000);
  circuit = await wasm_tester(CIRCUIT_PATH, {
    output: BUILD_DIR,
    recompile: false,
  });

  layers = buildFixedTree(SERIALS);
  merkleRoot = getRoot(layers);
  ({ pathElements, pathIndices } = getMerkleProof(layers, 0)); // serial "10" at index 0
});

function validInput(overrides = {}) {
  return {
    merkleRoot,
    serial: BigInt("10"),
    pathElements,
    pathIndices,
    ...overrides,
  };
}

describe("membership.circom — valid proof", () => {
  it("passes all constraints for a member serial", async function () {
    this.timeout(15_000);
    const w = await circuit.calculateWitness(validInput(), true);
    await circuit.checkConstraints(w);
  });

  it("passes for a different member serial with its own proof", async function () {
    this.timeout(15_000);
    const { pathElements: pe, pathIndices: pi } = getMerkleProof(layers, 1); // serial "20"
    const w = await circuit.calculateWitness(
      validInput({ serial: BigInt("20"), pathElements: pe, pathIndices: pi }),
      true
    );
    await circuit.checkConstraints(w);
  });
});

describe("membership.circom — invalid proof", () => {
  // In circom 2.x, the WASM witness calculator enforces === constraints
  // at witness-generation time (sanityCheck=true), throwing "Assert Failed".

  it("fails when merkleRoot does not match", async function () {
    this.timeout(15_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ merkleRoot: merkleRoot + 1n }), true),
      /Assert Failed/
    );
  });

  it("fails when a path element is tampered", async function () {
    this.timeout(15_000);
    const badPath = [...pathElements];
    badPath[0] = badPath[0] + 1n;
    await assert.rejects(
      circuit.calculateWitness(validInput({ pathElements: badPath }), true),
      /Assert Failed/
    );
  });

  it("fails when serial is not in the tree", async function () {
    this.timeout(15_000);
    // Proof was built for serial "10" — using "99" with the same path will fail
    await assert.rejects(
      circuit.calculateWitness(validInput({ serial: BigInt("99") }), true),
      /Assert Failed/
    );
  });

  it("fails when path indices are swapped (wrong direction)", async function () {
    this.timeout(15_000);
    const flippedIndices = pathIndices.map((i) => 1 - i);
    await assert.rejects(
      circuit.calculateWitness(validInput({ pathIndices: flippedIndices }), true),
      /Assert Failed/
    );
  });
});
