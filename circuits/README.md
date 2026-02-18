# Ballot — ZK Circuits

Zero-knowledge circuits for private, token-gated voting.

## Circuits

### `membership.circom`
Proves that the prover owns an NFT serial number that exists in a Merkle tree of eligible holders — without revealing which serial.

### `vote.circom`
Extends membership proof with:
- **Nullifier**: a deterministic hash of `(serial, secret)` that prevents double-voting while preserving anonymity
- **Vote commitment**: binds the proof to a specific choice index

## Build

Requires [circom](https://docs.circom.io/getting-started/installation/) and [snarkjs](https://github.com/iden3/snarkjs).

```bash
# Compile circuits → r1cs + wasm
pnpm compile

# Trusted setup → zkey + vkey
pnpm setup
```

## Status
These circuits are **placeholders**. The constraint logic is stubbed out. A real implementation needs:
- Poseidon hash components (from circomlib)
- Merkle path verification
- Nullifier derivation
- Choice index range check
