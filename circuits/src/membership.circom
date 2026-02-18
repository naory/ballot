pragma circom 2.1.6;

// Placeholder membership circuit
// Proves: "I own an NFT serial that is in the Merkle tree" without revealing which serial.
//
// Inputs:
//   - merkleRoot (public): root of the NFT-holder Merkle tree
//   - serial (private): the NFT serial number owned by the prover
//   - pathElements[depth] (private): sibling hashes along the Merkle path
//   - pathIndices[depth] (private): 0/1 direction at each level
//
// TODO: Replace SHA-256 with Poseidon hash for efficiency inside the circuit.

template Membership(depth) {
    signal input merkleRoot;
    signal input serial;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    signal output root;

    // Placeholder — real implementation will hash serial into a leaf,
    // then walk the Merkle path using Poseidon and constrain root == merkleRoot.
    root <== merkleRoot;
}

component main {public [merkleRoot]} = Membership(20);
