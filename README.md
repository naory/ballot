# Ballot

**Private, token-gated voting on Hedera using zero-knowledge proofs.**

Ballot lets NFT communities run anonymous polls where voters prove eligibility (NFT ownership) without revealing their identity. Votes are submitted to Hedera Consensus Service (HCS), verified with ZK proofs, and tallied by a lightweight indexer.

## Why

On-chain voting today is either fully transparent (anyone can see who voted for what) or relies on trusted intermediaries. Ballot solves this with ZK proofs:

- **Privacy**: Your vote is secret. The ZK proof shows you're eligible without revealing which NFT you hold.
- **Sybil resistance**: Each NFT serial can only vote once, enforced by a nullifier (a deterministic hash that prevents double-voting without linking back to your identity).
- **Verifiability**: Anyone can verify the proofs and recompute the tally from HCS messages.
- **No backend trust**: HCS provides the immutable message log. The indexer is a convenience layer — results can be independently verified.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                   │
│  - Browse polls, cast votes                             │
│  - Client-side ZK proof generation (snarkjs)            │
│  - Submit vote messages to HCS                          │
└─────────────┬───────────────────────────┬───────────────┘
              │ HCS messages              │ GraphQL
              ▼                           ▼
┌─────────────────────┐    ┌──────────────────────────────┐
│   Hedera Consensus   │    │      Indexer (Node.js)        │
│   Service (HCS)      │◄───│  - Subscribe to HCS topics    │
│                      │    │  - Verify ZK proofs (snarkjs) │
│   Hedera Token       │    │  - Store in SQLite             │
│   Service (HTS)      │    │  - Serve results via GraphQL   │
└──────────────────────┘    └──────────────────────────────┘
```

### Flow

1. **Poll creation**: Creator specifies an HTS NFT token ID and choices. The app snapshots current NFT holders via Mirror Node, builds a Merkle tree, and publishes poll metadata to a new HCS topic.

2. **Voting**: A voter generates a ZK proof client-side proving:
   - They own an NFT serial in the eligible Merkle tree (without revealing which)
   - A deterministic nullifier derived from their serial + a secret (prevents double-voting)
   - Their chosen option

   The proof + nullifier + choice are submitted as an HCS message.

3. **Tallying**: The indexer subscribes to HCS topics, verifies each proof with snarkjs, rejects duplicates (same nullifier), and maintains a running tally in SQLite. Results are served via a GraphQL API.

## Project Structure

```
ballot/
├── app/              Next.js 14 frontend (Tailwind, @hashgraph/sdk)
├── indexer/          Node.js service (snarkjs verifier, SQLite, GraphQL Yoga)
├── circuits/         Circom ZK circuits (membership + vote)
├── packages/
│   └── core/         Shared types and Merkle tree utilities
├── turbo.json        Turborepo pipeline
└── pnpm-workspace.yaml
```

## Prerequisites

- **Node.js** 20+ (see `.nvmrc`)
- **pnpm** 9+
- **circom** 2.1+ (for circuit compilation) — [install guide](https://docs.circom.io/getting-started/installation/)
- **snarkjs** (installed as a dependency)

## Setup

```bash
# Clone and install
git clone <repo-url> ballot
cd ballot
pnpm install

# Start the frontend
pnpm --filter @ballot/app dev        # http://localhost:3000

# Start the indexer
pnpm --filter @ballot/indexer dev    # GraphQL at http://localhost:4000/graphql
```

### ZK Circuits (optional — placeholder circuits)

```bash
# Compile circuits (requires circom)
pnpm --filter @ballot/circuits compile

# Trusted setup
pnpm --filter @ballot/circuits setup
```

### Environment Variables

Copy `app/.env.example` to `app/.env.local` and fill in:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_HEDERA_NETWORK` | `testnet` or `mainnet` |
| `NEXT_PUBLIC_HEDERA_OPERATOR_ID` | Hedera account ID |
| `HEDERA_OPERATOR_KEY` | Hedera private key (server-side only) |
| `NEXT_PUBLIC_INDEXER_URL` | Indexer GraphQL endpoint |
| `NEXT_PUBLIC_MIRROR_NODE_URL` | Hedera Mirror Node REST URL |

## Status

This is a **scaffold**. Key TODO items:

- [ ] Implement Poseidon hash in circom circuits (replace SHA-256 placeholder)
- [ ] Wire up Merkle proof generation in the vote flow
- [ ] Implement poll creation (HCS topic + Merkle tree snapshot)
- [ ] Connect frontend to indexer GraphQL
- [ ] Add wallet connection (HashPack / Blade)
- [ ] Implement nullifier derivation in the circuit
- [ ] Add poll expiry enforcement
- [ ] Production trusted setup ceremony

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Chain | Hedera (HCS + HTS) |
| ZK | Circom 2 + snarkjs (Groth16) |
| Frontend | Next.js 14, Tailwind CSS, @hashgraph/sdk |
| Indexer | Node.js, snarkjs, SQLite (better-sqlite3), GraphQL Yoga |
| Monorepo | pnpm workspaces + Turborepo |

## License

MIT
