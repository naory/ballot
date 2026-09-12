/**
 * Merkle tree helpers for circuit tests.
 * Must match packages/core/src/merkle.ts exactly — the circuit validates
 * against the same hashing scheme, so any divergence causes test failures.
 */

const { poseidon1, poseidon2 } = require("poseidon-lite");

const TREE_DEPTH = 10; // must match vote.circom / membership.circom depth param
const ZERO_LEAF = poseidon1([0n]);

function hashLeaf(serial) {
  return poseidon1([BigInt(serial)]);
}

function hashPair(left, right) {
  return poseidon2([left, right]); // positional — NOT sorted
}

/**
 * Build a fixed-depth Poseidon Merkle tree from an array of serial strings.
 * Pads to exactly 2^TREE_DEPTH leaves with ZERO_LEAF (matches buildFixedTree in core).
 * Returns layers bottom-up.
 */
function buildFixedTree(serials) {
  const size = 2 ** TREE_DEPTH;
  const leaves = serials.map((s) => hashLeaf(s));
  while (leaves.length < size) leaves.push(ZERO_LEAF);

  const layers = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(
        i + 1 < current.length
          ? hashPair(current[i], current[i + 1])
          : current[i]
      );
    }
    layers.push(next);
    current = next;
  }
  return layers;
}

function getRoot(layers) {
  return layers[layers.length - 1][0];
}

/**
 * Returns { pathElements: bigint[], pathIndices: number[] } for use as circuit inputs.
 *
 * pathIndices convention (matches MerkleVerifier.circom):
 *   0 = current node is left child (sibling is right)
 *   1 = current node is right child (sibling is left)
 */
function getMerkleProof(layers, leafIndex) {
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    pathElements.push(layer[siblingIdx]);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }

  return { pathElements, pathIndices };
}

/**
 * Compute nullifier = Poseidon(serial, secret) — matches zk.ts and vote.circom.
 */
function computeNullifier(serial, secret) {
  return poseidon2([BigInt(serial), BigInt(secret)]);
}

// --- vote_v2 helpers (F1/F2) ---
const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const IDENTITY_DOMAIN = 1n;

function identitySecretFromField(seedField) {
  return poseidon2([IDENTITY_DOMAIN, BigInt(seedField) % FIELD_ORDER]);
}
function identityCommitment(secret) {
  return poseidon1([secret]);
}
function commitmentLeaf(commitment, weight) {
  return poseidon2([BigInt(commitment), BigInt(weight)]);
}
function voteNullifier(secret, pollId) {
  return poseidon2([secret, BigInt(pollId)]);
}
/** Build a fixed tree from precomputed leaf hashes (bigint[]). */
function buildFixedTreeFromLeaves(leafHashes) {
  const size = 2 ** TREE_DEPTH;
  const leaves = leafHashes.slice();
  while (leaves.length < size) leaves.push(ZERO_LEAF);
  const layers = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }
    layers.push(next);
    current = next;
  }
  return layers;
}

module.exports = {
  TREE_DEPTH,
  ZERO_LEAF,
  hashLeaf,
  hashPair,
  buildFixedTree,
  getRoot,
  getMerkleProof,
  computeNullifier,
  FIELD_ORDER,
  identitySecretFromField,
  identityCommitment,
  commitmentLeaf,
  voteNullifier,
  buildFixedTreeFromLeaves,
};
