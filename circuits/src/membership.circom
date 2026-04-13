pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "./lib/merkle.circom";

// Proves that a voter owns an NFT serial in the eligible set (Merkle tree)
// without revealing which serial.
//
// Public inputs:  merkleRoot
// Private inputs: serial, pathElements[], pathIndices[]
template Membership(depth) {
    signal input merkleRoot;
    signal input serial;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Compute leaf = Poseidon(serial)
    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== serial;

    // Verify Merkle inclusion; constrain computed root == declared root
    component merkle = MerkleVerifier(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i]  <== pathIndices[i];
    }
    merkle.root === merkleRoot;
}

component main {public [merkleRoot]} = Membership(20);
