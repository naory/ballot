/**
 * Merkle tree utilities for building the NFT-holder eligibility set.
 *
 * Uses Poseidon hashing to match the ZK circuit (vote.circom / membership.circom).
 * SHA-256 cannot be used here — the off-circuit root must equal the in-circuit root.
 */

import { poseidon1, poseidon2 } from "poseidon-lite";

/**
 * Fixed tree depth used by the ZK circuit.
 * Supports up to 2^TREE_DEPTH = 1,024 eligible NFTs per poll.
 * Must match the `depth` parameter in vote.circom and membership.circom.
 */
export const TREE_DEPTH = 10;

/** Canonical empty-leaf value — Poseidon(0). Used to pad fixed-depth trees. */
const ZERO_LEAF = poseidon1([0n]);

/** Hash a leaf from an NFT serial number string → BigInt field element */
export function hashLeaf(serial: string): bigint {
  return poseidon1([BigInt(serial)]);
}

/**
 * Hash a left and right child node into their parent.
 * Order is positional — a is always left, b is always right.
 * This matches the circuit's MerkleVerifier which uses Mux1(pathIndices)
 * to select left/right; no numeric sorting is done in-circuit.
 */
export function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}

/** Build a Merkle tree from an array of leaf hashes. Returns layers (bottom-up). */
export function buildTree(leaves: bigint[]): bigint[][] {
  if (leaves.length === 0) throw new Error("Cannot build tree from 0 leaves");

  const layers: bigint[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: bigint[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        // Odd leaf — promote without hashing
        next.push(current[i]);
      }
    }
    layers.push(next);
    current = next;
  }

  return layers;
}

/** Get the Merkle root as a decimal string (field element, matches snarkjs convention) */
export function getRoot(layers: bigint[][]): string {
  return layers[layers.length - 1][0].toString();
}

/**
 * Generate a Merkle proof for the leaf at `index`.
 *
 * `direction` is the sibling's side ("right" = sibling is right = current is left).
 * When feeding this proof to the ZK circuit, convert to pathIndices:
 *   pathIndices[i] = step.direction === "left" ? 1 : 0
 * (circuit uses 0 = current is left child, 1 = current is right child)
 */
export function getProof(
  layers: bigint[][],
  index: number
): { sibling: string; direction: "left" | "right" }[] {
  const proof: { sibling: string; direction: "left" | "right" }[] = [];
  let idx = index;

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;

    if (siblingIdx < layer.length) {
      proof.push({
        sibling: layer[siblingIdx].toString(),
        direction: isRight ? "left" : "right",
      });
    }

    idx = Math.floor(idx / 2);
  }

  return proof;
}

/**
 * Build a fixed-depth Merkle tree padded to exactly 2^TREE_DEPTH leaves.
 * Positions beyond the provided leaves are filled with ZERO_LEAF.
 * This guarantees proofs always have exactly TREE_DEPTH elements — required
 * for the ZK circuit which expects a fixed-length pathElements array.
 *
 * Throws if more than 2^TREE_DEPTH leaf hashes are provided.
 */
export function buildFixedTree(leafHashes: bigint[]): bigint[][] {
  const size = 2 ** TREE_DEPTH;
  if (leafHashes.length > size) {
    throw new Error(
      `Too many leaves: ${leafHashes.length} exceeds capacity ${size} (2^${TREE_DEPTH})`
    );
  }
  const padded = [...leafHashes];
  while (padded.length < size) padded.push(ZERO_LEAF);
  return buildTree(padded);
}

/**
 * Build circuit-ready Merkle inputs for a single member of an eligible set.
 *
 * Given the full list of leaf preimages (e.g. NFT serials or credential IDs)
 * and the caller's own value, returns `{ merkleRoot, pathElements, pathIndices }`
 * ready to feed to the ZK circuit — with `pathIndices` in the circuit convention
 * (0 = current is left child, 1 = current is right child).
 *
 * This runs client-side so a voter can generate their proof from the public
 * eligible set without ever revealing which member they are (see F4). It uses the
 * same `buildFixedTree`/`getProof` primitives as the poll's committed root, so the
 * root it derives matches the on-chain `merkleRoot`.
 *
 * Throws if `target` is not in `values`.
 */
export function buildCircuitMerkleProof(
  values: string[],
  target: string
): { merkleRoot: string; pathElements: string[]; pathIndices: number[] } {
  const idx = values.indexOf(target);
  if (idx === -1) {
    throw new Error(`${target} is not in the eligible set`);
  }
  const layers = buildFixedTree(values.map(hashLeaf));
  const rawProof = getProof(layers, idx);
  return {
    merkleRoot: getRoot(layers),
    pathElements: rawProof.map((p) => p.sibling),
    pathIndices: rawProof.map((p) => (p.direction === "left" ? 1 : 0)),
  };
}

/** Verify a Merkle proof against a root (off-circuit check, e.g. in tests) */
export function verifyProof(
  leaf: bigint,
  proof: { sibling: string; direction: "left" | "right" }[],
  root: string
): boolean {
  let current = leaf;

  for (const step of proof) {
    const sibling = BigInt(step.sibling);
    // direction = sibling's side; current node is on the opposite side
    const [left, right] =
      step.direction === "right" ? [current, sibling] : [sibling, current];
    current = hashPair(left, right);
  }

  return current.toString() === root;
}

/** Leaf hash for a commitment-weight pair: Poseidon(commitment, weight). */
export function hashCommitmentLeaf(commitment: bigint, weight: bigint): bigint {
  return hashPair(commitment, weight);
}

/**
 * Build circuit-ready Merkle inputs for a voter's own commitment within a poll's
 * eligible leaf set. Leaves are hashed as Poseidon(commitment, weight). Runs
 * client-side so the voter never reveals which leaf is theirs.
 * Throws if `myCommitment` is not present.
 */
export function buildCommitmentMerkleProof(
  leaves: { commitment: string; weight: string }[],
  myCommitment: string
): { merkleRoot: string; leafIndex: number; pathElements: string[]; pathIndices: number[] } {
  const idx = leaves.findIndex((l) => l.commitment === myCommitment);
  if (idx === -1) throw new Error(`Commitment ${myCommitment} is not in the eligible set`);
  const leafHashes = leaves.map((l) => hashCommitmentLeaf(BigInt(l.commitment), BigInt(l.weight)));
  const layers = buildFixedTree(leafHashes);
  const rawProof = getProof(layers, idx);
  return {
    merkleRoot: getRoot(layers),
    leafIndex: idx,
    pathElements: rawProof.map((p) => p.sibling),
    pathIndices: rawProof.map((p) => (p.direction === "left" ? 1 : 0)),
  };
}
