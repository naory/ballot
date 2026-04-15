# Ballot — Roadmap

Development history and future directions.

---

## Completed phases

### Phase 1 — ZK circuits

- Implemented `membership.circom` with Poseidon Merkle verification (circomlib)
- Implemented `vote.circom`: Merkle membership + nullifier + 8-bit choice range check
- Replaced SHA-256 with Poseidon in `packages/core/merkle.ts` (must match in-circuit hash)
- Fixed nullifier pre-computation in `app/src/lib/zk.ts`
- Compile + trusted setup scripts (`circuits/scripts/compile.sh`, `setup.sh`) using Hermez `pot15_final.ptau`

### Phase 2 — End-to-end wiring

- Indexer handles `poll_created` and `vote` HCS messages
- REST API: `GET /api/polls`, `/api/polls/:topicId`, `/api/polls/:topicId/merkle-proof`
- GraphQL: `polls`, `poll`, `tally` queries
- Vote flow in `VoteForm.tsx`: fetch Merkle proof → generate ZK proof → submit to HCS
- Home page fetches live polls from the indexer

### Phase 3 — Poll creation

- Mirror Node snapshot of NFT holders at poll creation time
- Create-poll server action: builds Merkle tree, creates HCS topic, publishes `poll_created` with `serials[]`
- `serials[]` stored alongside the poll so Merkle proofs stay consistent after NFT transfers

### Phase 4 — Test coverage

- Circuit tests with `circom_tester` (`vote.circom`, `membership.circom`) — constraint violation tests use `calculateWitness(input, true)` which throws `"Assert Failed"` in circom 2.x
- `verifier.test.ts` — mocks snarkjs; tests valid/invalid/throws cases
- `integration.test.ts` — in-memory SQLite; exercises full verify → insert → tally chain
- `merkle.test.ts` — round-trip proof generation and root consistency

### Phase 5 — Hardening

- Poll expiry enforced using HCS consensus timestamp (tamper-resistant, set by the network)
- `choiceIndex` bounds checked against actual choice list before DB insert
- `handler.ts` extracted from `index.ts` with injectable `verify` parameter for testability
- Indexer Dockerfile + `fly.toml` for deployment (monorepo root as build context, persistent SQLite volume)
- Trusted setup uses Hermez `pot15_final.ptau` (multi-party ceremony, production-safe for testnet)

### Phase 6 — idOS credential-gated voting

- `vote_with_credential.circom` — proves NFT membership + credential membership + dual nullifiers simultaneously
- `IdosConfig` type added to `Poll`/`HCSPollMessage`; `credentialNullifier` added to `HCSVoteMessage`
- DB: `idos_config`, `credential_ids` on polls; `credential_nullifier UNIQUE` on votes
- Indexer routes credential-gated votes to `verifier_credential.ts`; enforces both nullifiers
- REST: `GET /api/polls/:topicId/credential-proof?credentialId=` endpoint
- `app/src/lib/idos.ts` — idOS SDK integration stub; derives `credentialSecret` from wallet signature
- `app/src/lib/zk.ts` — `generateVoteWithCredentialProof` for the 5-signal circuit

---

## Potential future work

- **Wallet connection** — HashPack / Blade wallet integration for serial discovery and signing
- **Frontend UX** — Poll creation UI, live tally charts, vote receipt display
- **idOS SDK wiring** — Replace the stub in `idos.ts` with live `@idos-network/idos-sdk` calls
- **Multi-party ceremony** — Additional `snarkjs zkey contribute` rounds for mainnet-grade trusted setup
- **CDN for artifacts** — The `.zkey` files are large (~10 MB each); serve from a CDN rather than Next.js `public/`
- **HCS topic ACLs** — Lock down poll-metadata topics so only the creator can submit `poll_created`
- **Mainnet deployment** — Production Fly.io config, Vercel frontend, mainnet Hedera credentials
