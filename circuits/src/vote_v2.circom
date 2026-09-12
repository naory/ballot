pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/merkle.circom";

// Ownership-proof vote (F1/F2). Proves:
//   1. commitment = Poseidon(identitySecret)
//   2. leaf = Poseidon(commitment, weight) is in the eligible Merkle tree
//   3. nullifierHash = Poseidon(identitySecret, pollId)  (deterministic, one/identity/poll)
//   4. choiceIndex is 8-bit; weight is 64-bit
//
// Public:  merkleRoot, nullifierHash, choiceIndex, pollId, weight
// Private: identitySecret, pathElements[], pathIndices[]
template Vote_v2(depth) {
    signal input merkleRoot;
    signal input nullifierHash;
    signal input choiceIndex;
    signal input pollId;
    signal input weight;

    signal input identitySecret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // 1. commitment = Poseidon(identitySecret)
    component commit = Poseidon(1);
    commit.inputs[0] <== identitySecret;

    // 2. leaf = Poseidon(commitment, weight)
    component leafHash = Poseidon(2);
    leafHash.inputs[0] <== commit.out;
    leafHash.inputs[1] <== weight;

    // 3. Merkle membership
    component merkle = MerkleVerifier(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i]  <== pathIndices[i];
    }
    merkle.root === merkleRoot;

    // 4. nullifier = Poseidon(identitySecret, pollId)
    component nul = Poseidon(2);
    nul.inputs[0] <== identitySecret;
    nul.inputs[1] <== pollId;
    nul.out === nullifierHash;

    // 5. range checks
    component cbits = Num2Bits(8);
    cbits.in <== choiceIndex;
    component wbits = Num2Bits(64);
    wbits.in <== weight;
}

// depth=10 matches TREE_DEPTH in packages/core/src/merkle.ts
component main {public [merkleRoot, nullifierHash, choiceIndex, pollId, weight]} = Vote_v2(10);
