const path = require("path");
const assert = require("assert");
const { wasm: wasm_tester } = require("circom_tester");
const {
  identitySecretFromField,
  identityCommitment,
  commitmentLeaf,
  voteNullifier,
  buildFixedTreeFromLeaves,
  getRoot,
  getMerkleProof,
} = require("./helpers");

const CIRCUIT_PATH = path.join(__dirname, "../src/vote_v2.circom");
const BUILD_DIR = path.join(__dirname, "../build");

const POLL_ID = 12345n;
const WEIGHT = 1n;

let circuit, layers, merkleRoot, pathElements, pathIndices, secret, commitment, nullifier;

before(async function () {
  this.timeout(60_000);
  circuit = await wasm_tester(CIRCUIT_PATH, { output: BUILD_DIR, recompile: false });

  secret = identitySecretFromField("777");
  commitment = identityCommitment(secret);
  // three eligible identities; voter is index 0
  const commitments = [commitment, identityCommitment(identitySecretFromField("2")), identityCommitment(identitySecretFromField("3"))];
  const leafHashes = commitments.map((c) => commitmentLeaf(c, WEIGHT));
  layers = buildFixedTreeFromLeaves(leafHashes);
  merkleRoot = getRoot(layers);
  ({ pathElements, pathIndices } = getMerkleProof(layers, 0));
  nullifier = voteNullifier(secret, POLL_ID);
});

function validInput(overrides = {}) {
  return {
    merkleRoot, nullifierHash: nullifier, choiceIndex: 1, pollId: POLL_ID, weight: WEIGHT,
    identitySecret: secret, pathElements, pathIndices, ...overrides,
  };
}

describe("vote_v2.circom", () => {
  it("accepts a valid proof", async () => {
    const w = await circuit.calculateWitness(validInput(), true);
    await circuit.checkConstraints(w);
  });
  it("rejects a wrong secret (membership fails)", async () => {
    await assert.rejects(() =>
      circuit.calculateWitness(validInput({ identitySecret: identitySecretFromField("42") }), true)
    );
  });
  it("rejects a tampered weight (leaf/root mismatch)", async () => {
    await assert.rejects(() => circuit.calculateWitness(validInput({ weight: 5n }), true));
  });
  it("rejects a mismatched nullifier", async () => {
    await assert.rejects(() =>
      circuit.calculateWitness(validInput({ nullifierHash: voteNullifier(secret, 999n) }), true)
    );
  });
  it("rejects choiceIndex = 256 (exceeds 8 bits)", async () => {
    await assert.rejects(() => circuit.calculateWitness(validInput({ choiceIndex: 256 }), true));
  });
});
