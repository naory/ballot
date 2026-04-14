# Ballot

**Private, token-gated voting on Hedera using zero-knowledge proofs.**

Ballot lets NFT communities run anonymous polls where voters prove eligibility without revealing their identity. Votes are submitted to Hedera Consensus Service (HCS), verified server-side with ZK proofs, and tallied by a lightweight indexer.

## Features

### NFT-gated voting

Any Hedera HTS NFT token can gate a poll. At poll creation time, the app snapshots all current NFT holders and commits their serial numbers into a Merkle tree. Voters then prove — using a Groth16 ZK proof — that they own a serial in that tree, without revealing which one.

- **Privacy**: The proof reveals nothing about which NFT you hold.
- **Sybil resistance**: Each serial can vote once, enforced by a nullifier: `Poseidon(serial, secret)`. The nullifier is stored publicly; the serial stays private.
- **Snapshot integrity**: Eligibility is fixed at poll creation. Transferring your NFT after the snapshot does not affect your voting right.

### idOS credential-gated voting

Polls can optionally require an [idOS](https://idos.network) credential in addition to NFT ownership — enabling "verified human, anonymous vote" for stronger sybil resistance (e.g. KYC or proof-of-humanity without doxing voters).

When a poll is created with `idosConfig`, it includes a second Merkle tree of valid credential IDs from the specified issuer. Voters must generate a proof using a separate `vote_with_credential` circuit that simultaneously proves:

1. NFT membership in the NFT Merkle tree
2. NFT nullifier (prevents double-voting with the same NFT)
3. Credential membership in the credential Merkle tree
4. Credential nullifier: `Poseidon(credentialId, credentialSecret)` (prevents reusing the same credential across votes)
5. Valid choice index (0–255)

Both nullifiers are stored by the indexer. A vote is rejected if either has been seen before.

Polls that do **not** require idOS credentials use the standard `vote.circom` circuit and are entirely unaffected by this feature.

### Verifiability

Anyone can independently verify the full tally:

- All vote messages are permanently recorded on HCS.
- Proofs are included in each HCS message.
- The indexer's verification logic is open source — run your own instance and compare results.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                   │
│  Browse polls, cast votes                                │
│  Client-side ZK proof generation (snarkjs)              │
│  Submit vote messages to HCS                            │
└─────────────┬───────────────────────────┬───────────────┘
              │ HCS messages              │ REST / GraphQL
              ▼                           ▼
┌─────────────────────┐    ┌──────────────────────────────┐
│  Hedera Consensus    │    │      Indexer (Node.js)        │
│  Service (HCS)       │◄───│  Subscribe to HCS topics      │
│                      │    │  Verify ZK proofs (snarkjs)   │
│  Hedera Token        │    │  Deduplicate nullifiers        │
│  Service (HTS)       │    │  Store in SQLite               │
└──────────────────────┘    │  Serve results via GraphQL    │
                            └──────────────────────────────┘
```

### Data flow

1. **Poll creation** — Creator picks an HTS token and choices. The server action snapshots NFT holders via Mirror Node, builds a Poseidon Merkle tree, creates an HCS topic, and publishes `poll_created` (with `merkleRoot` and `serials[]`). For idOS polls, a second credential Merkle tree is also committed.

2. **Voting** — The voter enters their NFT serial and a secret. The app fetches their Merkle proof from the indexer, generates a Groth16 proof client-side, and submits a `vote` HCS message. For idOS polls, the app additionally fetches the credential proof and uses the `vote_with_credential` circuit.

3. **Indexing** — The indexer subscribes to poll topics. On each `vote` message it verifies the ZK proof, checks both nullifiers for uniqueness, and records the vote. Results are served via GraphQL and REST.

## Project structure

```
ballot/
├── app/              Next.js 14 frontend
│   └── src/lib/
│       ├── zk.ts         Client-side proof generation (vote + vote_with_credential)
│       ├── idos.ts       idOS credential retrieval wrapper
│       ├── hedera.ts     HCS message submission
│       ├── mirror.ts     Mirror Node NFT holder queries
│       └── indexer.ts    GraphQL client
├── indexer/          Node.js verifier + API service
│   └── src/
│       ├── db.ts                Schema + queries (SQLite, WAL mode)
│       ├── handler.ts           HCS message processing + security checks
│       ├── verifier.ts          Groth16 proof verification (vote circuit)
│       ├── verifier_credential.ts  Groth16 verification (credential circuit)
│       ├── tally.ts             Vote aggregation
│       └── api.ts               REST + GraphQL server
├── circuits/         Circom 2 ZK circuits
│   └── src/
│       ├── vote.circom                Standard NFT-gated vote
│       ├── vote_with_credential.circom  NFT + idOS credential vote
│       ├── membership.circom          Standalone membership proof
│       └── lib/merkle.circom          MerkleVerifier template (depth=10)
└── packages/
    └── core/         Shared types (Poll, Vote, ZKProof) + Poseidon Merkle utilities
```

## Prerequisites

- **Node.js** 20+ and **pnpm** 9+
- **circom** 2.1+ — required only for circuit compilation:

```bash
git clone https://github.com/iden3/circom.git
cd circom && cargo build --release && cargo install --path circom
```

## Setup

```bash
pnpm install
```

### ZK circuits

Required for the full voting flow and circuit tests. Skip if you only need the indexer or core package.

```bash
cd circuits
npm install
npm run compile   # → build/*.r1cs + build/vote_js/vote.wasm + build/vote_with_credential_js/...
npm run setup     # → build/*_final.zkey + build/*.vkey.json  (downloads ~86 MB ptau on first run)

# Copy artifacts for the frontend
mkdir -p ../app/public/circuits/vote_js ../app/public/circuits/vote_with_credential_js
cp build/vote_js/vote.wasm                            ../app/public/circuits/vote_js/
cp build/vote_final.zkey                              ../app/public/circuits/
cp build/vote.vkey.json                               ../app/public/circuits/
cp build/vote_with_credential_js/vote_with_credential.wasm  ../app/public/circuits/vote_with_credential_js/
cp build/vote_with_credential_final.zkey              ../app/public/circuits/
```

The indexer reads `vote.vkey.json` and `vote_with_credential.vkey.json` from `circuits/build/` by default. Override with `VKEY_PATH` and `CREDENTIAL_VKEY_PATH`.

### Environment variables

Copy `app/.env.example` to `app/.env.local`:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_HEDERA_NETWORK` | `testnet` or `mainnet` |
| `NEXT_PUBLIC_HEDERA_OPERATOR_ID` | Hedera account ID (e.g. `0.0.12345`) |
| `HEDERA_OPERATOR_KEY` | Hedera private key — server-side only |
| `NEXT_PUBLIC_INDEXER_URL` | Indexer GraphQL endpoint |
| `NEXT_PUBLIC_MIRROR_NODE_URL` | Hedera Mirror Node REST URL |

The indexer is configured via shell variables: `PORT` (default `4000`), `DB_PATH` (default `ballot.sqlite`), `VKEY_PATH`, `CREDENTIAL_VKEY_PATH`.

### Running locally

```bash
pnpm --filter @ballot/app dev        # http://localhost:3000
pnpm --filter @ballot/indexer dev    # http://localhost:4000/graphql
```

### Tests

```bash
pnpm test                            # all workspaces
pnpm --filter @ballot/core test      # Merkle utilities
pnpm --filter @ballot/indexer test   # verifier + handler + integration
# Circuit tests require circuits/build/ to exist (run compile + setup first)
```

## Tech stack

| Layer | Technology |
|---|---|
| Chain | Hedera HCS (vote log) + HTS (NFT gating) |
| ZK | Circom 2 + snarkjs, Groth16, Poseidon hash |
| Frontend | Next.js 14, Tailwind CSS, @hashgraph/sdk |
| Indexer | Node.js, snarkjs, SQLite (better-sqlite3), GraphQL Yoga |
| Monorepo | pnpm workspaces + Turborepo |

## License

MIT
