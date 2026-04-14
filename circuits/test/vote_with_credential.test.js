/**
 * Circuit tests for vote_with_credential.circom.
 *
 * Proves all five properties simultaneously:
 *   1. NFT membership    — serial is in the NFT Merkle tree
 *   2. NFT nullifier     — Poseidon(serial, secret) matches
 *   3. Credential        — credentialId is in the credential Merkle tree
 *   4. Cred nullifier    — Poseidon(credentialId, credentialSecret) matches
 *   5. Choice range      — choiceIndex is 0–255
 *
 * Run `npm run compile && npm run setup` in circuits/ before these tests.
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

const CIRCUIT_PATH = path.join(__dirname, "../src/vote_with_credential.circom");
const BUILD_DIR = path.join(__dirname, "../build");

// ── NFT fixtures ─────────────────────────────────────────────────────────────
const SERIALS = ["1", "2", "3", "4", "5"];
const VOTER_SERIAL = "1";
const VOTER_SECRET = "99999";

// ── Credential fixtures ───────────────────────────────────────────────────────
// Credential IDs must be numeric strings — they become field elements in the circuit.
const CREDENTIAL_IDS = ["101", "202", "303"];
const VOTER_CRED_ID = "101"; // index 0
const VOTER_CRED_SECRET = "77777";

let circuit;

// NFT tree
let nftLayers;
let merkleRoot;
let pathElements;
let pathIndices;
let nullifier;

// Credential tree
let credLayers;
let credentialMerkleRoot;
let credPathElements;
let credPathIndices;
let credentialNullifier;

before(async function () {
  this.timeout(60_000);
  circuit = await wasm_tester(CIRCUIT_PATH, {
    output: BUILD_DIR,
    recompile: false,
  });

  // Build NFT tree
  nftLayers = buildFixedTree(SERIALS);
  merkleRoot = getRoot(nftLayers);
  ({ pathElements, pathIndices } = getMerkleProof(nftLayers, 0));
  nullifier = computeNullifier(VOTER_SERIAL, VOTER_SECRET);

  // Build credential tree (uses hashLeaf for credentialId strings too)
  credLayers = buildFixedTree(CREDENTIAL_IDS);
  credentialMerkleRoot = getRoot(credLayers);
  ({ pathElements: credPathElements, pathIndices: credPathIndices } = getMerkleProof(credLayers, 0));
  credentialNullifier = computeNullifier(VOTER_CRED_ID, VOTER_CRED_SECRET);
});

function validInput(overrides = {}) {
  return {
    // Public
    merkleRoot,
    nullifierHash: nullifier,
    choiceIndex: 1,
    credentialMerkleRoot,
    credentialNullifier,
    // Private NFT
    serial: BigInt(VOTER_SERIAL),
    secret: BigInt(VOTER_SECRET),
    pathElements,
    pathIndices,
    // Private credential — circuit computes Poseidon(credentialId) internally as leaf
    credentialId: BigInt(VOTER_CRED_ID),
    credentialSecret: BigInt(VOTER_CRED_SECRET),
    credentialPathElements: credPathElements,
    credentialPathIndices: credPathIndices,
    ...overrides,
  };
}

describe("vote_with_credential.circom — valid proof", () => {
  it("passes all constraints for a well-formed vote with credential", async function () {
    this.timeout(30_000);
    const w = await circuit.calculateWitness(validInput(), true);
    await circuit.checkConstraints(w);
  });
});

describe("vote_with_credential.circom — NFT Merkle constraint", () => {
  it("fails when NFT merkleRoot does not match", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ merkleRoot: merkleRoot + 1n }), true),
      /Assert Failed/
    );
  });

  it("fails when NFT path element is tampered", async function () {
    this.timeout(30_000);
    const badPath = [...pathElements];
    badPath[0] = badPath[0] + 1n;
    await assert.rejects(
      circuit.calculateWitness(validInput({ pathElements: badPath }), true),
      /Assert Failed/
    );
  });

  it("fails when serial is not in the NFT tree", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ serial: BigInt("9999") }), true),
      /Assert Failed/
    );
  });
});

describe("vote_with_credential.circom — NFT nullifier constraint", () => {
  it("fails when nullifierHash does not match Poseidon(serial, secret)", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ nullifierHash: nullifier + 1n }), true),
      /Assert Failed/
    );
  });
});

describe("vote_with_credential.circom — credential Merkle constraint", () => {
  it("fails when credentialMerkleRoot does not match", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ credentialMerkleRoot: credentialMerkleRoot + 1n }), true),
      /Assert Failed/
    );
  });

  it("fails when credential path element is tampered", async function () {
    this.timeout(30_000);
    const badPath = [...credPathElements];
    badPath[0] = badPath[0] + 1n;
    await assert.rejects(
      circuit.calculateWitness(validInput({ credentialPathElements: badPath }), true),
      /Assert Failed/
    );
  });

  it("fails when credentialId is not in the credential tree", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ credentialId: BigInt("99999999") }), true),
      /Assert Failed/
    );
  });
});

describe("vote_with_credential.circom — credential nullifier constraint", () => {
  it("fails when credentialNullifier does not match Poseidon(credentialId, credentialSecret)", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ credentialNullifier: credentialNullifier + 1n }), true),
      /Assert Failed/
    );
  });
});

describe("vote_with_credential.circom — choiceIndex range constraint", () => {
  it("accepts choiceIndex = 255 (8-bit upper bound)", async function () {
    this.timeout(30_000);
    const w = await circuit.calculateWitness(validInput({ choiceIndex: 255 }), true);
    await circuit.checkConstraints(w);
  });

  it("rejects choiceIndex = 256 (exceeds Num2Bits(8))", async function () {
    this.timeout(30_000);
    await assert.rejects(
      circuit.calculateWitness(validInput({ choiceIndex: 256 }), true),
      /Assert Failed/
    );
  });
});
