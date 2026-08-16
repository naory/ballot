# Ballot

**Private, identity-commitment-gated voting on Hedera using zero-knowledge proofs.**

Ballot lets communities run anonymous polls where voters prove eligibility without revealing their identity. Voters register an identity commitment on a shared HCS registry topic once; the poll creator snapshots those commitments into a Merkle tree. Votes are submitted to Hedera Consensus Service (HCS), verified server-side with ZK proofs, and tallied by a lightweight indexer.

## Features

### Identity-commitment voting

Eligibility is proven via a one-time **registration** step. Before a poll opens, a voter publishes a `register` message — containing `commitment = Poseidon(identitySecret)` and a signature — to a shared HCS **registry topic**. The indexer verifies the signature against the voter's Hedera account key and records the commitment.

At poll creation time, the app snapshots registered commitments and commits them (as `Poseidon(commitment, weight)` leaves) into a Poseidon Merkle tree. Voters then prove — using a Groth16 ZK proof (`vote_v2.circom`) — that they know the `identitySecret` behind a leaf in that tree, without revealing which one.

- **Privacy**: The proof reveals `{nullifier, choice, pollId, weight}` — nothing that links back to the voter's account or commitment.
- **Sybil resistance**: Nullifier = `Poseidon(identitySecret, pollId)` — deterministic and poll-scoped. One identity can produce exactly one nullifier per poll; picking a fresh secret is not possible. The nullifier is stored publicly; the secret stays on-device.
- **Weighted votes**: Each leaf encodes a weight; the tally sums weights rather than counting heads. Default polls use weight = `"1"` (unweighted).
- **Snapshot integrity**: Eligibility is fixed at poll creation. Registering after the snapshot does not affect the current poll.

> **Note on credential-gated polls:** Polls with `idosConfig` (idOS credential requirement) are **currently disabled** — the indexer rejects credential-gated votes and poll creation rejects `idosConfig` parameters. This feature is pending F7 (idOS + wallet integration).

### Verifiability

Anyone can independently verify the full tally:

- All vote messages are permanently recorded on HCS.
- Proofs are included in each HCS message.
- The indexer's verification logic is open source — run your own instance and compare results.

> **Design & trust model:** see [DESIGN.md](DESIGN.md) for the accepted decisions on
> eligibility (committed ACL vs. NFT), trustless tally verification from HCS, mobile
> wallet custody, and the known security flaws being addressed.

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

1. **Registration (one-time)** — Before a poll opens, each voter publishes a `register` message to the shared HCS registry topic (`REGISTRY_TOPIC_ID`). The message contains `commitment = Poseidon(identitySecret)` and a signature over the commitment. The indexer verifies the signature against the account's on-chain key and stores the commitment.

2. **Poll creation** — Creator picks choices and a snapshot window. The server action fetches registered commitments from the indexer, builds a Poseidon Merkle tree (leaves = `Poseidon(commitment, weight)`), creates an HCS topic, and publishes `poll_created` (with `merkleRoot` and `leaves[]`). Credential-gated polls (`idosConfig`) are rejected — pending F7.

3. **Voting** — The voter's `identitySecret` is used client-side to locate their leaf and build the Merkle proof **in-browser** (see [DESIGN.md](DESIGN.md) F4). The app generates a Groth16 proof (`vote_v2.circom`) with public signals `[merkleRoot, nullifierHash, choiceIndex, pollId, weight]` and submits a `vote` HCS message. Nullifier = `Poseidon(identitySecret, pollId)` — one per identity per poll.

4. **Indexing** — The indexer subscribes to poll topics. On each `vote` message it binds envelope fields to `publicSignals` (F3), verifies the ZK proof, deduplicates nullifiers, and records the vote (with weight). Results are served via GraphQL and REST. Tally sums weight rather than counting raw votes.

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
| `NEXT_PUBLIC_REGISTRY_TOPIC_ID` | HCS topic ID for identity-commitment registration (e.g. `0.0.XXXXX`). The `RegisterButton` component publishes voter commitments here. |
| `CREATE_POLL_API_KEY` | Server-side. When set, `POST /api/create-poll` requires `Authorization: Bearer <key>` (see [DESIGN.md](DESIGN.md) F5). If unset, the endpoint is unauthenticated. |

The indexer is configured via shell variables: `PORT` (default `4000`), `DB_PATH` (default `ballot.sqlite`), `VKEY_PATH`, `CREDENTIAL_VKEY_PATH`, `BALLOT_CREATOR_ACCOUNT_ID` (accounts allowed to define polls; defaults to `HEDERA_OPERATOR_ID`, see [DESIGN.md](DESIGN.md) F6), `REGISTRY_TOPIC_ID` (the same HCS registry topic watched for `register` messages; if unset the indexer logs a warning and skips registration ingestion), `ALLOWED_ORIGINS` (comma-separated CORS allowlist; unset ⇒ permissive `*`, see [DESIGN.md](DESIGN.md) F5), and `POLL_INTERVAL_MS` (Mirror Node poll cadence; default `5000`).

At startup the indexer preflights the verification keys and logs whether each is available; a missing key is reported clearly and causes the affected votes to be rejected (rather than silently failing) until it is provided. HCS ingestion is at-least-once and eventually consistent — see the liveness note in `indexer/src/subscriber.ts`.

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
