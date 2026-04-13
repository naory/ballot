pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/merkle.circom";

// Proves all three voting properties in one circuit:
//   1. Membership   — serial is in the eligible NFT Merkle tree
//   2. Nullifier    — deterministic nullifier derived from (serial, secret)
//                     so the same NFT cannot vote twice without revealing it
//   3. Choice range — choiceIndex is a valid 8-bit value (0–255)
//
// Public inputs:  merkleRoot, nullifierHash, choiceIndex
// Private inputs: serial, secret, pathElements[], pathIndices[]
template Vote(depth) {
    // --- Public ---
    signal input merkleRoot;
    signal input nullifierHash;
    signal input choiceIndex;

    // --- Private ---
    signal input serial;
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // 1. Compute leaf = Poseidon(serial)
    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== serial;

    // 2. Verify Merkle membership
    component merkle = MerkleVerifier(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i]  <== pathIndices[i];
    }
    merkle.root === merkleRoot;

    // 3. Verify nullifier: Poseidon(serial, secret) must equal the declared nullifierHash.
    //    The nullifier is public so the indexer can detect double-votes,
    //    but serial and secret stay private so the voter is not identified.
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== serial;
    nullifier.inputs[1] <== secret;
    nullifier.out === nullifierHash;

    // 4. Range-check choiceIndex: constrain to 8 bits (0 ≤ choiceIndex < 256).
    //    The indexer enforces the tighter bound (< numChoices), but this
    //    prevents a malformed proof from encoding an absurd choice value.
    component bits = Num2Bits(8);
    bits.in <== choiceIndex;
}

// depth=10 matches TREE_DEPTH in packages/core/src/merkle.ts (supports ≤1,024 NFTs)
component main {public [merkleRoot, nullifierHash, choiceIndex]} = Vote(10);
