import { describe, it, expect } from "vitest";
import {
  hashLeaf,
  hashPair,
  buildTree,
  buildFixedTree,
  getRoot,
  getProof,
  verifyProof,
  TREE_DEPTH,
} from "./merkle.js";
import { poseidon1, poseidon2 } from "poseidon-lite";

// ---------------------------------------------------------------------------
// hashLeaf / hashPair
// ---------------------------------------------------------------------------

describe("hashLeaf", () => {
  it("returns poseidon1([BigInt(serial)])", () => {
    expect(hashLeaf("42")).toBe(poseidon1([42n]));
    expect(hashLeaf("1")).toBe(poseidon1([1n]));
  });

  it("different serials produce different hashes", () => {
    expect(hashLeaf("1")).not.toBe(hashLeaf("2"));
  });
});

describe("hashPair", () => {
  it("is positional — hashPair(a,b) ≠ hashPair(b,a)", () => {
    const a = hashLeaf("1");
    const b = hashLeaf("2");
    expect(hashPair(a, b)).not.toBe(hashPair(b, a));
  });

  it("matches poseidon2([a, b])", () => {
    const a = hashLeaf("10");
    const b = hashLeaf("20");
    expect(hashPair(a, b)).toBe(poseidon2([a, b]));
  });
});

// ---------------------------------------------------------------------------
// buildTree / getRoot
// ---------------------------------------------------------------------------

describe("buildTree", () => {
  it("single leaf: root equals the leaf", () => {
    const leaf = hashLeaf("1");
    const layers = buildTree([leaf]);
    expect(getRoot(layers)).toBe(leaf.toString());
  });

  it("two leaves: root equals hashPair(left, right)", () => {
    const l = hashLeaf("1");
    const r = hashLeaf("2");
    const layers = buildTree([l, r]);
    expect(getRoot(layers)).toBe(hashPair(l, r).toString());
  });

  it("four leaves: correct root", () => {
    const leaves = [1n, 2n, 3n, 4n].map((n) => hashLeaf(n.toString()));
    const layers = buildTree(leaves);
    const expectedRoot = hashPair(
      hashPair(leaves[0], leaves[1]),
      hashPair(leaves[2], leaves[3])
    );
    expect(getRoot(layers)).toBe(expectedRoot.toString());
  });

  it("throws on empty leaf array", () => {
    expect(() => buildTree([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildFixedTree
// ---------------------------------------------------------------------------

describe("buildFixedTree", () => {
  it(`pads to 2^${TREE_DEPTH} leaves`, () => {
    const layers = buildFixedTree([hashLeaf("1"), hashLeaf("2")]);
    // Bottom layer must be exactly 2^TREE_DEPTH
    expect(layers[0].length).toBe(2 ** TREE_DEPTH);
  });

  it("produces TREE_DEPTH+1 layers", () => {
    const layers = buildFixedTree([hashLeaf("1")]);
    expect(layers.length).toBe(TREE_DEPTH + 1);
  });

  it("throws when too many leaves", () => {
    const tooMany = Array.from({ length: 2 ** TREE_DEPTH + 1 }, (_, i) =>
      hashLeaf(String(i))
    );
    expect(() => buildFixedTree(tooMany)).toThrow(/Too many leaves/);
  });
});

// ---------------------------------------------------------------------------
// getProof / verifyProof — round-trip
// ---------------------------------------------------------------------------

describe("getProof / verifyProof", () => {
  const serials = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const leaves = serials.map(hashLeaf);
  const layers = buildFixedTree(leaves);
  const root = getRoot(layers);

  it("verifies a proof for every leaf in the set", () => {
    for (let i = 0; i < serials.length; i++) {
      const proof = getProof(layers, i);
      expect(proof).toHaveLength(TREE_DEPTH);
      expect(verifyProof(leaves[i], proof, root)).toBe(true);
    }
  });

  it("rejects a proof for a leaf not in the set", () => {
    const outsider = hashLeaf("999");
    const proof = getProof(layers, 0); // proof for serial "1"
    expect(verifyProof(outsider, proof, root)).toBe(false);
  });

  it("rejects a tampered proof (wrong sibling)", () => {
    const proof = getProof(layers, 0);
    const tampered = [
      { sibling: hashLeaf("999").toString(), direction: proof[0].direction },
      ...proof.slice(1),
    ] as typeof proof;
    expect(verifyProof(leaves[0], tampered, root)).toBe(false);
  });

  it("root from single-leaf fixed tree verifies correctly", () => {
    const singleLeaf = hashLeaf("42");
    const singleLayers = buildFixedTree([singleLeaf]);
    const singleRoot = getRoot(singleLayers);
    const proof = getProof(singleLayers, 0);
    expect(verifyProof(singleLeaf, proof, singleRoot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Proof path length for fixed tree
// ---------------------------------------------------------------------------

describe("proof length", () => {
  it("always returns exactly TREE_DEPTH elements for buildFixedTree", () => {
    const layers = buildFixedTree([hashLeaf("1"), hashLeaf("2"), hashLeaf("3")]);
    for (let i = 0; i < 3; i++) {
      expect(getProof(layers, i)).toHaveLength(TREE_DEPTH);
    }
  });
});
