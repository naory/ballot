# Ballot — Implementation Roadmap

> Status: scaffold complete, ZK circuits are placeholders. This doc tracks everything needed to reach a working, production-ready app.

---

## Phase 1 — ZK Circuits (current blocker)

The circuits compile but prove nothing. All other phases depend on this.

### 1.1 Implement `membership.circom`

Replace the placeholder with real Poseidon-based Merkle verification using circomlib.

- Import `circomlib/circuits/poseidon.circom`
- Compute `leaf = Poseidon(serial)`
- Walk `depth` levels: at each level select `(left, right)` using `pathIndices[i]`, compute `Poseidon(left, right)`
- Constrain final computed root `== merkleRoot`

### 1.2 Implement `vote.circom`

Compose membership + nullifier + range check.

- Import and instantiate `Membership(depth)` sub-circuit
- Compute `nullifier = Poseidon(serial, secret)` and constrain `== nullifierHash`
- Range-check `choiceIndex`: add a `Num2Bits` or `LessThan` constraint so it can't exceed `numChoices - 1`
- Consider reducing `depth` from 20 → 10 (handles up to 1,024 NFT holders; cuts proving time ~2×)

### 1.3 Fix hash in `packages/core/merkle.ts`

`merkle.ts` uses SHA-256. The circuit uses Poseidon. The off-circuit Merkle root must match the in-circuit one — they must use the same hash.

- Replace SHA-256 with Poseidon via `poseidon-lite` (browser + Node compatible, no native deps)
- `hashLeaf(serial)` → `poseidon([BigInt(serial)])`
- `hashPair(a, b)` → `poseidon([a, b])` (sorted by value for consistency)

### 1.4 Fix nullifier pre-computation in `app/src/lib/zk.ts`

`zk.ts:48` passes `nullifierHash: "0"` — a placeholder. The circuit verifies the nullifier internally, so the caller must supply the correct value.

- Compute `nullifierHash = poseidon([BigInt(serial), BigInt(secret)])` before calling `fullProve`
- Return it as `nullifier` in `ProofResult` (it's also `publicSignals[1]`)

### 1.5 Compile circuits and run trusted setup

```bash
# Requires: circom (https://docs.circom.io), snarkjs globally
cd circuits
npm run compile   # → build/{membership,vote}.r1cs + build/vote_js/vote.wasm
npm run setup     # → build/vote_final.zkey + build/vote.vkey.json
```

Copy artifacts to the Next.js public folder:
```
public/circuits/vote_js/vote.wasm
public/circuits/vote_final.zkey
```
Copy `build/vote.vkey.json` to `indexer/` (or set `VKEY_PATH` env var).

**Deliverable:** `snarkjs groth16 fullProve` generates a real proof; `verifyVoteProof` in the indexer returns `true`.

---

## Phase 2 — Wire the App End-to-End

Scaffolding is in place; just the plumbing is missing.

### 2.1 Indexer — handle poll creation messages

`subscriber.ts` decodes HCS messages but doesn't act on them. In `index.ts` / the message handler:

- On `type === "poll_created"`: store poll in SQLite (`db.ts`), subscribe to that poll's topic
- On `type === "vote"`: call `verifyVoteProof(proof, publicSignals)`, check nullifier not already seen, insert into DB

### 2.2 Indexer — expose polls via GraphQL / REST

`api.ts` likely has stubs. Add:
- `GET /polls` — list all polls with tally
- `GET /polls/:topicId` — single poll + Merkle root + choices
- `GET /polls/:topicId/merkle-proof?serial=` — return path elements + indices for a given NFT serial (needed by the frontend before proof generation)

### 2.3 `VoteForm.tsx` — implement the vote flow

Replace the `alert(...)` TODO with the real three-step flow:

1. Call indexer `GET /polls/:topicId/merkle-proof?serial=<userSerial>` to get path
2. Call `generateVoteProof({ merkleRoot, serial, secret, pathElements, pathIndices, choiceIndex })`
3. Submit HCS message via `hedera.ts`

Add a wallet connection step to get the user's serial from their NFT holdings (via Mirror Node).

### 2.4 `HomePage` — replace mock polls with live data

Fetch from indexer `GET /polls` instead of `MOCK_POLLS`.

**Deliverable:** Full vote flow works on Hedera testnet: create poll → cast vote → indexer verifies proof → tally updates.

---

## Phase 3 — Poll Creation Flow

### 3.1 Mirror Node snapshot

In `app/src/lib/mirror.ts` (stub exists):
- `GET /api/v1/tokens/:tokenId/nfts` — paginate all serials for the token at a given block
- Build the Merkle tree from all serial numbers using the Poseidon `merkle.ts`

### 3.2 Create-poll page (`app/src/app/create/page.tsx`)

Wire up the form to:
1. Fetch NFT holders → build Merkle tree → compute root
2. Publish `HCSPollMessage` to a new HCS topic (via Hedera SDK)
3. Redirect to the poll page

### 3.3 Secret management

Voters need a stable `(serial, secret)` pair to re-derive their nullifier across sessions. Options (pick one):

- **Simple**: derive `secret = keccak256(walletSignature || pollTopicId)` — no storage needed
- **Better**: store encrypted in `localStorage` keyed by `topicId`

**Deliverable:** Any NFT holder can create a poll; the app snapshots eligibility and publishes to HCS.

---

## Phase 4 — Test Coverage

### 4.1 Circuit unit tests

Use `@noir-lang/noir_js` or `circom_tester` (npm: `circom_tester`):
- Valid membership proof passes
- Invalid path fails (root mismatch)
- Double-vote attempt: same nullifier → constraint failure
- Out-of-range `choiceIndex` → constraint failure

### 4.2 `merkle.ts` tests

- Round-trip: build tree from known serials, verify proof for each leaf
- Root matches what the circuit computes for the same inputs

### 4.3 Indexer integration test

- Submit a valid HCS vote message → `verifyVoteProof` returns true → tally increments
- Submit duplicate nullifier → rejected

---

## Phase 5 — Hardening & Testnet Deployment

### 5.1 Trusted setup ceremony (production)

The `setup.sh` script uses a single-contributor ceremony, which is not production-safe.  
Before mainnet: use an existing Powers of Tau file (e.g. Hermez `pot15_final.ptau`) or run a multi-party ceremony.

### 5.2 Security review checklist

- [ ] Nullifier uniqueness enforced both in-circuit and in DB (two layers)
- [ ] `choiceIndex` range check prevents out-of-bounds vote
- [ ] Merkle depth matches tree depth used at snapshot time
- [ ] HCS topic ACLs: poll topic should be open-submit, poll-metadata topic write-protected
- [ ] Indexer rejects votes submitted before `startsAt` or after `endsAt`

### 5.3 Deploy to testnet

- Indexer: deploy as a Node.js service (Fly.io / Railway)
- Frontend: Vercel
- Circuit artifacts: serve from Next.js `public/` (or a CDN for the `.zkey` — it can be large)

---

## Phase 6 — idOS Integration (optional enhancement)

Once core voting works, polls can optionally require an idOS credential in addition to NFT ownership. This enables "verified human, anonymous vote" — stronger sybil resistance.

### How it would work

1. Poll creator sets `requireIdosCredential: true` + `idosIssuerId` in poll metadata
2. At vote time: user presents a ZK proof of their idOS credential (proving they hold a valid credential from the specified issuer, without revealing identity)
3. Circuit extended: add a credential commitment input alongside the Merkle membership proof
4. Indexer verifies both proofs before counting

### What needs to be built

- Extend `vote.circom` with a credential commitment sub-circuit (or a separate `credential.circom`)
- Frontend: integrate idOS Client SDK to retrieve and re-encrypt credential for the ZK witness
- Types: extend `Poll` with `idosConfig?: { issuerId: string; credentialType: string }`

**This phase is self-contained** — it doesn't change the core vote circuit for polls that don't use it.

---

## Summary

| Phase | Scope | Blocking? |
|-------|-------|-----------|
| 1 — ZK Circuits | Implement real constraints, fix hash mismatch, compile | Yes — nothing works without this |
| 2 — App wiring | Connect frontend → indexer → HCS | Yes — Phase 1 done first |
| 3 — Poll creation | Mirror Node snapshot, create-poll UI | No — can be done in parallel with Phase 2 |
| 4 — Tests | Circuit + indexer test coverage | No — run alongside Phases 2–3 |
| 5 — Hardening | Trusted setup, security review, testnet deploy | After Phases 1–3 |
| 6 — idOS | Credential-gated polls | Optional, after Phase 5 |
