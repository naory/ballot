pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/merkle.circom";

// Extends Vote(depth) with a second Merkle membership proof for an idOS credential.
//
// Proves all five properties:
//   1. NFT membership    — serial is in the eligible NFT Merkle tree
//   2. NFT nullifier     — Poseidon(serial, secret) prevents NFT double-voting
//   3. Credential        — credentialId is in the issuer's credential Merkle tree
//   4. Cred nullifier    — Poseidon(credentialId, credentialSecret) prevents
//                          the same credential being used twice
//   5. Choice range      — choiceIndex is a valid 8-bit value (0–255)
//
// Public inputs:  merkleRoot, nullifierHash, choiceIndex,
//                 credentialMerkleRoot, credentialNullifier
// Private inputs: serial, secret, pathElements[], pathIndices[],
//                 credentialId, credentialSecret,
//                 credentialPathElements[], credentialPathIndices[]
//
// Circuit is self-contained — polls that do NOT require idOS credentials
// continue to use vote.circom unchanged.
template VoteWithCredential(depth) {
    // ── Public ──────────────────────────────────────────────────────────────
    signal input merkleRoot;
    signal input nullifierHash;
    signal input choiceIndex;
    signal input credentialMerkleRoot;
    signal input credentialNullifier;

    // ── Private (NFT) ────────────────────────────────────────────────────────
    signal input serial;
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // ── Private (credential) ─────────────────────────────────────────────────
    signal input credentialId;
    signal input credentialSecret;
    signal input credentialPathElements[depth];
    signal input credentialPathIndices[depth];

    // 1. Compute NFT leaf = Poseidon(serial)
    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== serial;

    // 2. Verify NFT Merkle membership
    component merkle = MerkleVerifier(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i]  <== pathIndices[i];
    }
    merkle.root === merkleRoot;

    // 3. Verify NFT nullifier: Poseidon(serial, secret) == nullifierHash
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== serial;
    nullifier.inputs[1] <== secret;
    nullifier.out === nullifierHash;

    // 4. Compute credential leaf = Poseidon(credentialId)
    component credLeafHash = Poseidon(1);
    credLeafHash.inputs[0] <== credentialId;

    // 5. Verify credential Merkle membership
    component credMerkle = MerkleVerifier(depth);
    credMerkle.leaf <== credLeafHash.out;
    for (var i = 0; i < depth; i++) {
        credMerkle.pathElements[i] <== credentialPathElements[i];
        credMerkle.pathIndices[i]  <== credentialPathIndices[i];
    }
    credMerkle.root === credentialMerkleRoot;

    // 6. Verify credential nullifier: Poseidon(credentialId, credentialSecret)
    component credNullifier = Poseidon(2);
    credNullifier.inputs[0] <== credentialId;
    credNullifier.inputs[1] <== credentialSecret;
    credNullifier.out === credentialNullifier;

    // 7. Range-check choiceIndex to 8 bits (matches vote.circom)
    component bits = Num2Bits(8);
    bits.in <== choiceIndex;
}

// depth=10 matches TREE_DEPTH in packages/core/src/merkle.ts
component main {public [merkleRoot, nullifierHash, choiceIndex, credentialMerkleRoot, credentialNullifier]} = VoteWithCredential(10);
