# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Ballot** — private, token-gated voting on Hedera using zero-knowledge proofs. NFT holders prove eligibility via a ZK Groth16 proof (Circom + snarkjs) without revealing which NFT they own, then submit votes to Hedera Consensus Service (HCS). An indexer verifies proofs and tallies results via GraphQL.

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
cp circuits/build/vote_js/vote.wasm app/public/circuits/vote_js/
cp circuits/build/vote_final.zkey   app/public/circuits/
cp circuits/build/vote.vkey.json    app/public/circuits/
# The indexer reads vote.vkey.json from circuits/build/ by default (VKEY_PATH env to override)
```

### Environment Setup

Copy `app/.env.example` to `app/.env.local`:

```
NEXT_PUBLIC_HEDERA_NETWORK=testnet
NEXT_PUBLIC_HEDERA_OPERATOR_ID=0.0.XXXXX
HEDERA_OPERATOR_KEY=302e...           # server-side only
NEXT_PUBLIC_INDEXER_URL=http://localhost:4000/graphql
NEXT_PUBLIC_MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com
```

The indexer has no `.env` — configure via shell: `PORT`, `DB_PATH` (default `ballot.sqlite` in cwd), `VKEY_PATH`.

## Architecture

```
packages/core/     Shared types (Poll, Vote, Tally, ZKProof, HCS message envelopes)
                   + Merkle tree utilities (Poseidon hashing — must match circuits)

circuits/          Circom 2 ZK circuits
  vote.circom      Main circuit: Merkle membership + nullifier + choice range check
  membership.circom  Standalone membership-only circuit
  lib/merkle.circom  MerkleVerifier template (depth=10 → ≤1,024 NFTs per poll)

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

1. **Poll creation** (server action in `app/`): snapshot NFT holders via Mirror Node → build fixed-depth Poseidon Merkle tree → create HCS topic → publish `poll_created` message containing `merkleRoot` + `serials[]`.

2. **Voting** (client-side in `app/`): user provides their NFT serial + a secret → snarkjs generates Groth16 proof with public signals `[merkleRoot, nullifierHash, choiceIndex]` → submit `vote` message to HCS topic.

3. **Indexing**: indexer subscribes to HCS topics → on `poll_created`, stores poll in SQLite and subscribes to new topic → on `vote`, calls `snarkjs.groth16.verify` with `circuits/build/vote.vkey.json`, rejects invalid proofs and duplicate nullifiers (UNIQUE constraint), stores verified vote.

### Critical Invariants

- **`TREE_DEPTH = 10`** is hardcoded in `packages/core/src/merkle.ts`, `circuits/src/vote.circom`, and `circuits/src/membership.circom`. All three must stay in sync.
- **Poseidon hashing only** — `hashLeaf(serial)` = `poseidon1([BigInt(serial)])`, `hashPair(l, r)` = `poseidon2([l, r])`. SHA-256 cannot be used because the off-circuit Merkle root must match the in-circuit root.
- **`pathIndices` convention**: `0` = current node is left child, `1` = current is right child. See `getProof()` in `merkle.ts` — the circuit's `Mux1` uses this convention.
- **Nullifier** = `Poseidon(serial, secret)` — computed identically in `app/src/lib/zk.ts` and constrained in `vote.circom`. The indexer deduplicates on nullifier (UNIQUE in SQLite) without learning the voter's serial.
- **`@ballot/core` must be built before `app` or `indexer`** — Turborepo handles this via `"dependsOn": ["^build"]`.

### Testing

- Tests use **Vitest** (`@ballot/core`, `@ballot/indexer`) and **Mocha** (`@ballot/circuits`).
- Indexer tests use an **in-memory SQLite DB**: `process.env.DB_PATH = ":memory:"` set before module import. Each test file gets isolation via Vitest's default `pool: 'forks'` behavior.
- No tests for the Next.js app (UI tests not yet implemented).
- **Circuit tests require compiled artifacts** in `circuits/build/`. On a fresh clone, run `cd circuits && npm install && npm run compile && npm run setup` before `pnpm test`, otherwise the `@ballot/circuits` suite will fail. The indexer's `verifier.test.ts` mocks snarkjs and does not need artifacts.
- Circuit artifacts (`vote.vkey.json`) are not available in CI unless compiled first — `verifier.ts` will throw on missing file.
