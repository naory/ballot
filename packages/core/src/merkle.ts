/**
 * Minimal Merkle tree utilities for building the NFT-holder set tree.
 *
 * In production this would use a Poseidon hash (snark-friendly).
 * For the scaffold we use SHA-256 as a placeholder.
 */

import { createHash } from "node:crypto";

/** Hash two buffers together (sorted for consistency) */
function hashPair(a: Buffer, b: Buffer): Buffer {
  const sorted = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return createHash("sha256")
    .update(Buffer.concat(sorted))
    .digest();
}

/** Hash a leaf value (NFT serial number as string) */
export function hashLeaf(serial: string): Buffer {
  return createHash("sha256").update(serial).digest();
}

/** Build a Merkle tree from an array of leaf hashes. Returns layers (bottom-up). */
export function buildTree(leaves: Buffer[]): Buffer[][] {
  if (leaves.length === 0) throw new Error("Cannot build tree from 0 leaves");

  const layers: Buffer[][] = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        // Odd leaf — promote it
        next.push(current[i]);
      }
    }
    layers.push(next);
    current = next;
  }

  return layers;
}

/** Get the Merkle root as a hex string */
export function getRoot(layers: Buffer[][]): string {
  return layers[layers.length - 1][0].toString("hex");
}

/** Generate a Merkle proof (array of sibling hashes + directions) for a leaf at `index` */
export function getProof(
  layers: Buffer[][],
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
        sibling: layer[siblingIdx].toString("hex"),
        direction: isRight ? "left" : "right",
      });
    }

    idx = Math.floor(idx / 2);
  }

  return proof;
}

/** Verify a Merkle proof against a root */
export function verifyProof(
  leaf: Buffer,
  proof: { sibling: string; direction: "left" | "right" }[],
  root: string
): boolean {
  let current = leaf;

  for (const step of proof) {
    const sibling = Buffer.from(step.sibling, "hex");
    current =
      step.direction === "right"
        ? hashPair(current, sibling)
        : hashPair(sibling, current);
  }

  return current.toString("hex") === root;
}
