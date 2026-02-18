pragma circom 2.1.6;

// Placeholder vote circuit
// Proves:
//   1. Membership — the voter owns an NFT in the eligible set (Merkle proof)
//   2. Nullifier — a deterministic nullifier derived from (serial, secret) so
//      the same NFT cannot vote twice, but the serial is not revealed.
//   3. Vote commitment — the chosen option index is committed.
//
// Public inputs:  merkleRoot, nullifier, choiceIndex
// Private inputs: serial, secret, pathElements[], pathIndices[]
//
// TODO: Implement Poseidon hashing and wire up membership sub-circuit.

template Vote(depth) {
    // Public
    signal input merkleRoot;
    signal input nullifierHash;
    signal input choiceIndex;

    // Private
    signal input serial;
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    signal output validVote;

    // Placeholder constraint — real implementation will:
    //   1. Compute leaf = Poseidon(serial)
    //   2. Walk Merkle path and assert root == merkleRoot
    //   3. Compute nullifier = Poseidon(serial, secret) and assert == nullifierHash
    //   4. Range-check choiceIndex
    validVote <== 1;
}

component main {public [merkleRoot, nullifierHash, choiceIndex]} = Vote(20);
