# F1/F2 — NFT Ownership Proof + Deterministic Identity-Bound Nullifier

**Status:** Design approved — not yet implemented.
**Closes:** #5 (F1, no ownership proof), #6 (F2, unlimited double-voting).
**Depends on / couples with:** DESIGN.md Decision 1 (committed ACL), Decision 2 (HCS as source of truth), Decision 3 (embedded non-custodial wallet). Builds on the merged F3–F8 hardening.

---

## 1. Problem

Two critical, related flaws remain in Ballot's voting integrity:

- **F1 — no ownership proof.** The eligible `serials[]` are published publicly in `poll_created`, and `vote.circom` only proves *"I know a serial in the Merkle set"* — which everyone does. Anyone can pick any serial off the public list and vote. Token-gating is not actually enforced.
- **F2 — unlimited double-voting.** `nullifier = Poseidon(serial, secret)` where `secret` is a value the voter picks (random, in `localStorage`). One serial can produce unlimited distinct nullifiers, so the same NFT can vote arbitrarily many times.

The circuit proves the wrong statement. To be sound it must bind **ownership** (control of the account that holds the NFT) and a **deterministic, identity-bound secret** (so each identity maps to exactly one nullifier per poll).

## 2. Goals / Non-goals

**Goals**
- A voter can only vote if they hold the gating NFT, proven without revealing which NFT (F1).
- Each eligible identity votes exactly once per poll; the vote is anonymous within the eligible set (F2).
- Publicly reproducible eligibility — no trusted database (Decision 2).
- Base "1 vote per identity", with weighting available later as a config toggle (no circuit redesign).
- Buildable and testable now against an `IdentityProvider` interface, before the full embedded wallet exists.

**Non-goals (deliberately deferred)**
- The full embedded wallet (MPC + passkey + encrypted-backup recovery). Only a minimal seed-storage provider ships now, behind the interface.
- Migrating the credential circuit (`vote_with_credential`) — that is F7/idOS work. Credential-gated poll creation is disabled until then.
- Enabling weighted polls (the machinery is built; poll creation emits `weight = 1` in v1).
- Coercion-resistance (MACI-style re-voting).

## 3. Key decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Eligibility anchor | **NFT holders + one-time registration** binding a Hedera account to a wallet-derived identity commitment. Not a pure allowlist; not in-circuit Ed25519. |
| D2 | Voting weight | **Per-identity base (1 vote).** Weight is bound into the leaf and carried as a public signal so weighted polls are a later config toggle. v1 emits `weight = 1`. |
| D3 | Identity secret (F2) | **Stored seed:** `secret = H(seed) mod r`, `seed` = 32 random bytes generated once and persisted by the wallet. Reproduced via the wallet, not voter-chosen. |
| D4 | Scope of the wallet identity layer | **Interface + minimal impl.** Define `IdentityProvider`; ship a minimal seed-storage implementation now; the full embedded-wallet provider drops in later behind the same interface. |
| D5 | Registration record store | **Public HCS registry topic.** Account→commitment bindings are HCS messages, Ed25519-verified and independently reproducible. |

`r` = the BN254 scalar field order (the field Groth16/Poseidon operate over). The identity secret only needs to be a field element — ownership is enforced at tree-construction time, not by an in-circuit signature — so no Baby JubJub / exotic-curve math is required.

## 4. Architecture

```
ONE-TIME per user                  PER POLL                          PER VOTE
─────────────────                  ────────                          ────────
wallet: seed → secret → commitment snapshot NFT holders (Mirror)     wallet: secret
user signs                         ∩ registered accounts             → find own leaf in poll set
 "ballot-register-v1:acct:commit"  → leaves = Poseidon(commit,wt)    → Groth16 (vote_v2):
 with Hedera key                   → merkle tree                       publics = [root, nullifier,
→ relay → HCS registry topic       → poll_created{root, leaves[]}      choice, pollId, weight]
indexer verifies Ed25519 sig,        on the poll topic               → relay → vote on poll topic
records account→commitment                                          indexer: verify + envelope
                                                                     bind + pollId + dedup
                                                                     nullifier + tally sums weight
```

**Why F1 is fixed:** a commitment enters a poll's tree only if the account (a) registered it with a valid Hedera signature (proves account control) and (b) holds the gating NFT at snapshot. The circuit proves knowledge of the secret behind an in-tree commitment. A non-holder can't get into the tree; a non-owner doesn't know another's secret.

**Why F2 is fixed:** the secret is wallet-stored, not voter-chosen. `nullifier = Poseidon(secret, pollId)` is deterministic → one nullifier per identity per poll → one counted vote.

## 5. Components

### 5.1 IdentityProvider (`app/src/lib/identity.ts`)

```ts
interface IdentityProvider {
  getIdentitySecret(): Promise<bigint>;   // H(seed) mod r
  getCommitment(): Promise<bigint>;        // Poseidon([secret])
  signRegistration(): Promise<{ accountId: string; commitment: string; signature: string }>;
}
```

- **Secret:** `secret = H(seed) mod r`; `seed` = 32 random bytes generated **once**.
- **Commitment:** `Poseidon([secret])` — public, stable, reusable across all polls.
- **Unlinkability:** the commitment (`Poseidon(secret)`) and the per-poll nullifier (`Poseidon(secret, pollId)`) are both public, but neither can be inverted and they cannot be linked to each other without knowing `secret`. So even though the registry publicly binds `account → commitment`, a vote (which reveals only the nullifier) is not linkable to the account.
- **v1 storage:** seed persisted in the wallet's storage (browser secure storage for the MVP). Recovery/MPC/passkey is the later provider, same interface.
- **Consequence (documented):** pre-recovery, losing the seed means re-registering a new commitment.

### 5.2 Registration + HCS registry

- **Signed message (replay-safe, domain-separated):** `ballot-register-v1:<accountId>:<commitment>`, signed by the **Hedera account key** (Ed25519). `accountId` prevents cross-account replay; `commitment` binds the identity.
- **Submission:** user signs; the app **relays** the message to the registry topic (operator pays the HCS fee — the F6 relayer model; authenticity comes from the embedded Ed25519 signature, not the HCS payer).
- **Registry message:** `{ type: "register", accountId, commitment, signature, ts }`.
- **Indexer registry view:** subscribes to the registry topic and per message:
  1. Fetch the account's key from Mirror Node (`/accounts/{id}`).
  2. Verify the Ed25519 signature over the canonical message (off-circuit, standard verify).
  3. Upsert `account → commitment`, **latest-wins** by consensus timestamp (a wallet re-setup can re-register).
  4. Invalid sig / unknown account / key mismatch → rejected and logged.
- Publicly reproducible: anyone replays the topic and rebuilds the same map; no trusted DB.

### 5.3 Poll snapshot (updated `app/src/app/api/create-poll/route.ts`)

1. Snapshot NFT holders via Mirror Node → set of holder **accounts**.
2. Intersect with the registry → **only registered holders** are eligible. (Eligibility fixed at snapshot, as today. A holder must have registered before the snapshot — the one real UX cost of D1, mitigated by registration being one-time and reusable.)
3. Weight per identity: **v1 = 1**. (Weighted later: `#serials held` or an external value — no circuit change.)
4. Leaves: `Poseidon(commitment, weight)`, one per eligible identity.
5. `poll_created` publishes `merkleRoot` + the **leaf set** `[{commitment, weight}]` for client-side proof building (F4 no-serial-leak pattern). It does **not** publish account↔commitment; the vote reveals neither the commitment nor the account (the ZK proof hides which leaf), so anonymity holds across the eligible set.

### 5.4 `vote_v2.circom` (replaces the serial+secret circuit)

```
Public:  merkleRoot, nullifierHash, choiceIndex, pollId, weight
Private: identitySecret, pathElements[depth], pathIndices[depth]

Constraints:
  1. commitment   = Poseidon(identitySecret)
  2. leaf         = Poseidon(commitment, weight)
  3. MerkleVerifier(leaf, pathElements, pathIndices) === merkleRoot
  4. nullifierHash === Poseidon(identitySecret, pollId)
  5. Num2Bits(8)  on choiceIndex          // 0..255 (indexer enforces < numChoices)
  6. Num2Bits(64) on weight               // sanity bound; integrity comes from (2)
```

- Reuses the existing `MerkleVerifier` template and Poseidon; `TREE_DEPTH = 10` unchanged (no ptau/setup-size change).
- `weight` is public (the tally needs it) and bound into the leaf (2), so it cannot be inflated without breaking membership.
- `nullifierHash` binds to `pollId` (4): the same identity yields a different nullifier per poll but only one per poll.
- `pollId = H(topicId) mod r`, derived identically by client and indexer; as a public input it lets the indexer reject a proof minted for a different poll (cross-poll nullifier replay guard).
- No serial; no voter-chosen secret. `vote.circom` is superseded.

### 5.5 Client proof generation

- `app/src/lib/zk.ts` gains `generateVoteProofV2(identitySecret, leaves, choiceIndex, pollId)`: finds the voter's own leaf (matches on their commitment), builds the Merkle proof over `Poseidon(commitment, weight)` leaves, runs `groth16.fullProve`.
- `@ballot/core` gains `buildCommitmentMerkleProof(leaves, myCommitment)` — mirrors F4's `buildCircuitMerkleProof` but with the 2-input leaf hash; keeps the `direction → pathIndices` convention.
- If the voter's commitment isn't in the set → clear pre-proof error ("register first" vs "not a holder at snapshot").

### 5.6 Indexer verification (`indexer/src/handler.ts`)

For a `vote`, before dedup/insert (extends the F3 envelope-binding pattern to the new signals):

```
verify(proof, publicSignals)                    // new vote_v2 vkey (F8 loader)
publicSignals[0] === poll.merkle_root
publicSignals[1] === vote.nullifier
publicSignals[2] === String(vote.choiceIndex)
publicSignals[3] === pollId(poll.topic_id)      // recomputed server-side; never trusted from envelope
publicSignals[4] === String(vote.weight)
0 <= choiceIndex < numChoices
nullifier UNIQUE                                 // existing dedup
```

### 5.7 Weighted tally (`indexer/src/tally.ts`, `indexer/src/db.ts`)

- Add a `weight` column to the votes table.
- **Tally sums `weight` per choice** instead of counting rows. Unweighted polls (weight=1) → sum = count → identical to today's numbers.
- GraphQL/REST tally shape unchanged (`{choiceIndex, count}`); `count` becomes "summed weight."

## 6. Data flow (end to end)

1. **Register (once):** wallet → commitment; user signs `ballot-register-v1:<account>:<commitment>`; relay → registry topic; indexer records account→commitment.
2. **Poll creation:** snapshot holders ∩ registered → leaves `Poseidon(commitment, 1)` → tree → `poll_created{merkleRoot, leaves[]}` on the poll topic.
3. **Vote:** wallet → secret; find own leaf; `vote_v2` proof with publics `[root, Poseidon(secret,pollId), choice, pollId, weight]`; relay → vote message on the poll topic.
4. **Index/tally:** indexer verifies proof + envelope binding + pollId + nullifier dedup → tally sums weight.

## 7. Error handling

- Registration: invalid Hedera sig / unknown account / key mismatch → rejected and logged; not recorded.
- Vote by unregistered or ineligible identity → not in the tree → membership fails; UI pre-checks and shows distinct messages.
- Missing/invalid vkey → handled by the F8 loader (`VerificationKeyUnavailableError`, startup preflight).
- Credential-gated poll creation → disabled until F7 (avoid a weaker path).

## 8. Testing strategy

- **Circuit** (`circom_tester`): valid proof; wrong secret → membership fails; tampered weight → membership fails; `nullifierHash` binding; choice/weight range checks.
- **`@ballot/core`** (vitest): identity secret/commitment derivation vectors; `buildCommitmentMerkleProof` round-trip vs tree root.
- **Indexer** (vitest): registry sig verification (valid / bad sig / wrong account / unknown key); `pollId` binding rejects a cross-poll replayed proof; weighted tally sums correctly; envelope binding for the new signals; nullifier dedup.
- **App:** no test harness (per project setup); `identity.ts` gets a small pure-logic unit test where feasible.

## 9. Migration

- `vote.circom` (serial + voter-secret) is **superseded** by `vote_v2.circom`; new zkey/vkey (`VKEY_PATH` points at it). No production data exists → clean cutover; old circuit removed.
- Merkle leaf semantics change from NFT-serial to commitment; snapshot code updated; `poll_created` gains `{commitment, weight}` and drops raw serials.
- DB: add `weight` to votes; add a `registrations` table/view in the indexer.
- Docs: update README, CLAUDE.md, and DESIGN.md (mark F1/F2 remediation implemented; note the new registry topic env/config).

## 10. Open questions / follow-ups (not blocking this spec)

- **Registration submission fee model:** confirmed to reuse the F6-style operator relay; the concrete relay endpoint is assumed, not built here.
- **Registry topic identity:** one global registry topic per deployment vs. per-community — default to one per deployment; revisit if isolation is needed.
- **Weighted-poll anonymity:** emitting `weight` publicly shrinks the anonymity set to identities sharing that weight (leaks ~NFT count under NFT-count weighting). Deferred with weighted polls; mitigable later via bucketing/range proofs.
- **Credential circuit:** must adopt the same identity-commitment model under F7 before credential-gated polls are re-enabled.
