pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// Verifies a Merkle inclusion proof using Poseidon hashing.
//
// Inputs:
//   leaf              — the leaf value to prove inclusion of
//   pathElements[depth] — sibling hash at each level
//   pathIndices[depth]  — 0 if current node is left child, 1 if right child
//
// Output:
//   root — the computed Merkle root (constrain == expected root at call site)
template MerkleVerifier(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component muxLeft[depth];   // selects the left input to Poseidon at each level
    component muxRight[depth];  // selects the right input to Poseidon at each level

    signal levelHash[depth + 1];
    levelHash[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // When pathIndices[i] = 0: current node is left, sibling is right
        // When pathIndices[i] = 1: current node is right, sibling is left
        muxLeft[i] = Mux1();
        muxLeft[i].c[0] <== levelHash[i];    // index=0 → current goes left
        muxLeft[i].c[1] <== pathElements[i]; // index=1 → sibling goes left
        muxLeft[i].s    <== pathIndices[i];

        muxRight[i] = Mux1();
        muxRight[i].c[0] <== pathElements[i]; // index=0 → sibling goes right
        muxRight[i].c[1] <== levelHash[i];    // index=1 → current goes right
        muxRight[i].s    <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxLeft[i].out;
        hashers[i].inputs[1] <== muxRight[i].out;

        levelHash[i + 1] <== hashers[i].out;
    }

    root <== levelHash[depth];
}
