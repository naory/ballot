# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Ballot** — private, identity-commitment-gated voting on Hedera using zero-knowledge proofs. Voters register an identity commitment on a public HCS registry topic, then prove eligibility via a ZK Groth16 proof (Circom + snarkjs, `vote_v2.circom`) without revealing their identity, and submit votes to Hedera Consensus Service (HCS). An indexer verifies proofs and tallies results via GraphQL.

## Commands

This is a **pnpm + Turborepo** monorepo. Run commands from the repo root or use `--filter` to target a workspace.

```bash
# Install dependencies
pnpm install

# Run all dev servers in parallel
pnpm dev

# Run a specific workspace
pnpm --filter @ballot/app dev        # Next.js at http://localhost:3000
pnpm --filter @ballot/indexer dev    # GraphQL at http://localhost:4000/graphql

# Build everything (respects Turborepo dependency order: core → app/indexer)
pnpm build

# Run all tests
pnpm test

# Run tests in a specific workspace
pnpm --filter @ballot/core test
pnpm --filter @ballot/indexer test

# Run a single test file (from workspace directory)
cd indexer && npx vitest run src/db.test.ts
cd packages/core && npx vitest run src/merkle.test.ts

# Lint
pnpm lint
```

### ZK Circuit Commands (requires `circom` installed via Rust)

```bash
# Install circom: cargo install circom
cd circuits
npm install                    # installs circomlib
npm run compile                # → circuits/build/*.r1cs + *_js/*.wasm
npm run setup                  # → circuits/build/*.zkey + *.vkey.json

# After setup, copy artifacts for the frontend and indexer:
cp circuits/build/vote_v2_js/vote_v2.wasm app/public/circuits/vote_v2_js/
cp circuits/build/vote_v2_final.zkey       app/public/circuits/
cp circuits/build/vote_v2.vkey.json        app/public/circuits/
# The indexer reads vote_v2.vkey.json from circuits/build/ by default (VKEY_PATH env to override)
# vote_v2.circom replaces the retired vote.circom (ownership-proof model, F1/F2)
```

### Environment Setup

Copy `app/.env.example` to `app/.env.local`:

```
NEXT_PUBLIC_HEDERA_NETWORK=testnet
NEXT_PUBLIC_HEDERA_OPERATOR_ID=0.0.XXXXX
HEDERA_OPERATOR_KEY=302e...           # server-side only
NEXT_PUBLIC_INDEXER_URL=http://localhost:4000/graphql
NEXT_PUBLIC_MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com
NEXT_PUBLIC_REGISTRY_TOPIC_ID=0.0.XXXXX # HCS registry topic for account->commitment (F1/F2)
CREATE_POLL_API_KEY=...                # server-side; gates POST /api/create-poll (F5)
```

`CREATE_POLL_API_KEY` (app, server-side): when set, `POST /api/create-poll` requires `Authorization: Bearer <key>` so anonymous callers can't spend the operator's HBAR (F5). The route is also per-client rate-limited.

The indexer has no `.env` — configure via shell: `PORT`, `DB_PATH` (default `ballot.sqlite` in cwd), `VKEY_PATH`, `CREDENTIAL_VKEY_PATH`, `BALLOT_CREATOR_ACCOUNT_ID`, `ALLOWED_ORIGINS`, `POLL_INTERVAL_MS`, and `REGISTRY_TOPIC_ID`. `BALLOT_CREATOR_ACCOUNT_ID` is the account allowed to publish `poll_created`; **set it on the indexer process** to enforce poll authenticity (F6) — it is a separate process from the app and does not inherit `HEDERA_OPERATOR_ID`. If unset, the indexer logs a warning and does not enforce the payer check (the HCS submit key still protects new topics at the ledger). `ALLOWED_ORIGINS` is a comma-separated CORS allowlist (F5); unset ⇒ permissive `*`. `POLL_INTERVAL_MS` (default `5000`) is the Mirror Node poll cadence. `REGISTRY_TOPIC_ID` is the HCS topic on which voters publish identity-commitment registrations (F1); if unset, the indexer logs a warning and will not ingest registrations. Verification keys (`VKEY_PATH`, `CREDENTIAL_VKEY_PATH`) are preflighted at startup and logged; a missing key is reported clearly and rejects the affected votes rather than failing silently (F8).

## Architecture

```
packages/core/     Shared types (Poll, Vote, Tally, ZKProof, HCS message envelopes)
                   + Merkle tree utilities (Poseidon hashing — must match circuits)

circuits/          Circom 2 ZK circuits
  vote_v2.circom   Main circuit (F1/F2): commitment-weight leaf + deterministic nullifier
                   Public signals: [merkleRoot, nullifierHash, choiceIndex, pollId, weight]
  membership.circom  Standalone membership-only circuit
  lib/merkle.circom  MerkleVerifier template (depth=10 → ≤1,024 eligible identities per poll)
  (vote.circom retired — replaced by vote_v2.circom)

app/               Next.js 14 frontend
  src/lib/
    hedera.ts      HCS topic creation + message submission (@hashgraph/sdk)
    mirror.ts      Mirror Node REST queries (NFT holder snapshots)
    zk.ts          Client-side Groth16 proof generation (snarkjs)
    indexer.ts     GraphQL client to the indexer
  src/app/api/create-poll/   Server action: creates HCS topic, builds Merkle tree, publishes poll_created

indexer/           Node.js service
  src/db.ts        SQLite schema + queries (better-sqlite3, WAL mode)
  src/subscriber.ts  HCS topic subscriber (polls HCS for new messages)
  src/verifier.ts  Server-side snarkjs Groth16 proof verification
  src/tally.ts     Aggregates DB rows into Tally objects
  src/api.ts       GraphQL Yoga server (polls, votes, tallies)
```

### Data Flow

1. **Registration** (one-time, via `app/src/components/RegisterButton.tsx`): voter signs a message with their Hedera wallet and publishes a `register` message (containing `commitment = Poseidon(identitySecret)`) to the shared HCS **registry topic** (`REGISTRY_TOPIC_ID`). The indexer ingests and verifies the signature; the commitment is stored in SQLite and included in future poll snapshots.

2. **Poll creation** (server action in `app/`): snapshot registered commitments → build fixed-depth Poseidon Merkle tree (leaves = `Poseidon(commitment, weight)`) → create HCS topic → publish `poll_created` message containing `merkleRoot` + `leaves[]`.

3. **Voting** (client-side in `app/`): user's `identitySecret` proves membership via snarkjs Groth16 proof with public signals `[merkleRoot, nullifierHash, choiceIndex, pollId, weight]` → submit `vote` message to HCS topic. Nullifier = `Poseidon(identitySecret, pollId)` — deterministic, one per identity per poll.

4. **Indexing**: indexer subscribes to HCS topics → on `poll_created`, stores poll in SQLite and subscribes to new topic → on `vote`, verifies signals match envelope fields (F3) and calls `snarkjs.groth16.verify` with `vote_v2.vkey.json`, rejects invalid proofs and duplicate nullifiers (UNIQUE constraint), stores verified vote with weight. Credential-gated polls (`idosConfig`) are rejected pending F7.

### Critical Invariants

- **`TREE_DEPTH = 10`** is hardcoded in `packages/core/src/merkle.ts` and `circuits/src/vote_v2.circom` (and `circuits/src/membership.circom`). All must stay in sync.
- **Poseidon hashing only** — SHA-256 cannot be used because the off-circuit Merkle root must match the in-circuit root.
  - **Commitment leaf**: `leaf = Poseidon(commitment, weight)` where `commitment = Poseidon(identitySecret)`. Computed in `packages/core/src/merkle.ts` (`hashCommitmentLeaf`) and constrained in `vote_v2.circom`.
  - **Tree pair hash**: `hashPair(l, r)` = `poseidon2([l, r])`.
- **`pathIndices` convention**: `0` = current node is left child, `1` = current is right child. See `getProof()` in `merkle.ts` — the circuit's `Mux1` uses this convention.
- **Nullifier** = `Poseidon(identitySecret, pollId)` — deterministic and poll-scoped, computed in `app/src/lib/zk.ts` and constrained in `vote_v2.circom`. One identity produces exactly one nullifier per poll. The indexer deduplicates on nullifier (UNIQUE in SQLite) without learning the voter's identity.
- **`@ballot/core` must be built before `app` or `indexer`** — Turborepo handles this via `"dependsOn": ["^build"]`.

### Testing

- Tests use **Vitest** (`@ballot/core`, `@ballot/indexer`) and **Mocha** (`@ballot/circuits`).
- Indexer tests use an **in-memory SQLite DB**: `process.env.DB_PATH = ":memory:"` set before module import. Each test file gets isolation via Vitest's default `pool: 'forks'` behavior.
- No tests for the Next.js app (UI tests not yet implemented).
- **Circuit tests require compiled artifacts** in `circuits/build/`. On a fresh clone, run `cd circuits && npm install && npm run compile && npm run setup` before `pnpm test`, otherwise the `@ballot/circuits` suite will fail. The indexer's `verifier.test.ts` mocks snarkjs and does not need artifacts.
- Circuit artifacts (`vote_v2.vkey.json`) are not available in CI unless compiled first — a missing verification key is reported clearly at startup (F8) and causes the affected votes to be rejected (the verifiers return `false` rather than throwing).
