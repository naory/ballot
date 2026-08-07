# Ballot — Design Decisions

Architecture Decision Records for the trust, custody, and integrity model.

This document captures three linked decisions and the security remediations that
motivate them:

1. **Eligibility model** — how a voter's right to vote is represented.
2. **Vote recording & trustless verification** — how results are made auditable
   without trusting a central database.
3. **Wallet & custody** — how voters hold keys on mobile without a seed phrase.

It also records the **known flaws** in the current implementation and the fix
for each, since the decisions below are chosen partly to close them.

> Status: **accepted / not yet implemented.** These describe the target design.
> The current code (Phases 1–6) does not yet enforce most of it — see
> [Known flaws](#known-flaws--remediations).

---

## Threat model & goals

Ballot's core promise is **anonymous, one-vote-per-eligible-identity polling**
with **publicly verifiable results**. The design must hold against:

- A **curious or malicious operator** (the party running the indexer / relayer /
  poll-creation service). It must not be able to learn how anyone voted, forge
  votes, or silently mis-report the tally.
- A **malicious voter** trying to vote without eligibility, vote more than once,
  or vote as someone else.
- A **network observer** trying to link a voter's identity to their choice.

Non-goals: hiding *participation* is best-effort (see the "I voted" receipt note);
hiding the *eligible set's size* is not attempted; coercion-resistance (à la MACI
re-voting) is out of scope for v1.

Properties we require:

| Property | Mechanism |
|---|---|
| Eligibility | ZK membership proof against a committed eligibility set |
| Ownership (can't vote as someone else) | Signature challenge bound into the proof |
| One vote per identity | Deterministic, identity-bound nullifier |
| Ballot secrecy | Proof reveals only `{nullifier, choice}`, never the identity |
| Public verifiability | HCS as source of truth + reproducible tally |
| No custodial deanonymization | Non-custodial keys; on-device signing |

---

## Decision 1 — Eligibility as a committed ACL, not a per-voter NFT

### Context

The original design gates polls on an HTS NFT: the poll creator snapshots NFT
holders and commits their serials into a Poseidon Merkle tree (`serials[]` in
`poll_created`). We evaluated three ways to represent "who may vote":

- **(A) Pre-mint / airdrop an NFT** to each eligible voter.
- **(B) Voter self-mints** an eligibility NFT on demand.
- **(C) ACL committed as a Poseidon Merkle tree** of identity commitments — no
  per-voter token.

### Decision

**Use (C): the eligible set is an Access Control List committed as a Poseidon
Merkle tree of identity commitments, with the root published in `poll_created`
on HCS.** Do **not** mint a per-voter NFT purely to represent eligibility.

A "leaf" is an identity commitment, e.g. `Poseidon(voterPubKey)` or
`Poseidon(idOS credentialId)` — not an NFT serial.

> **Exception:** if the NFT is a *genuine, independently-meaningful asset* the
> community already holds (DAO membership, ticket, etc.), keep gating on it —
> snapshot holders as today and layer the ownership-proof fix (F1) on top. The
> point of this decision is only that we do **not** create throwaway NFTs whose
> sole purpose is voting eligibility.

### Rationale

- **On Hedera, "self-mint" (B) isn't real.** HTS minting requires the collection's
  supply key, so a voter can only mint if the service co-signs every mint — which
  means the ACL is already the real gate and the NFT is a redundant, costly shadow
  of it. Worse, the mint event links an account to "eligible voter" at vote time
  (a deanonymization vector close to the vote).
- **NFT eligibility is redundant with the Merkle root.** The root already commits
  the eligible set. The idOS path in the current code *already* builds its tree
  from `credentialIds` rather than NFTs (`credentialMerkleRoot`) — i.e. it is
  already the ACL-commitment model, and it works.
- **(C) is cheapest and most private:** zero per-voter on-chain transactions, and
  no public account↔eligibility link. This is the canonical ZK-voting design
  (Semaphore / MACI use identity-commitment trees).
- **(C) fits lazy wallet onboarding** (Decision 3): a commitment can be registered
  against a stable identity before a Hedera account is funded; the device key is
  bound at vote time inside the proof. Pre-minting (A) requires every voter's
  account to exist *before* the poll opens, which fights zero-friction onboarding.

### Consequences

- The `serials[]`-based tree becomes a *special case* (NFT-as-real-asset) of a
  general "commitment tree." `packages/core/src/merkle.ts` already supports
  arbitrary leaf preimages; only the leaf-derivation and the snapshot source change.
- A **registration/commitment step** is needed for non-NFT polls: voters (or the
  issuer) submit identity commitments that the creator aggregates into the root.
- Eligibility is fixed at the committed root; late registrants require a new poll
  or a documented re-snapshot, exactly as today.

---

## Decision 2 — HCS is the source of truth; the tally is independently reproducible

### Context

The indexer stores votes and tallies in SQLite and the frontend reads results
from it (`fetchPoll`, GraphQL `tally`). Taken at face value that looks like a
"central database" you must trust. The concern raised: how do we make the system
transparent rather than DB-dependent — and should votes be recorded as NFTs?

### Decision

**Keep HCS as the authoritative, append-only public log of votes-with-proofs.
Treat the indexer's SQLite as a disposable, reproducible projection of that log.
Do not record votes as NFTs.** Add the tooling that lets *any* third party
recompute the exact tally from HCS, reducing the indexer to untrusted
infrastructure.

### Rationale

- **HCS already provides** immutability, total ordering, consensus timestamps, and
  public data availability (via Mirror Node). Vote messages already carry the full
  `proof` + `publicSignals`. That *is* the transparent record.
- **An NFT-per-vote is strictly worse** than an HCS message for an append-only log:

  | | NFT mint per vote | HCS message per vote (current) |
  |---|---|---|
  | Purpose-built append-only log | No | **Yes** |
  | Ordering + timestamp | Not inherent | **Consensus timestamp built-in** |
  | Cost | Higher (mint + metadata) | **Lower (one message)** |
  | Data availability | Metadata often off-chain (IPFS) | **On-ledger** |
  | Privacy | Mint tied to a signing account | **Relayer-submitted → unlinked** |

- The DB is a **cache**: if it lies or drops a vote, anyone replaying the topic can
  prove it. That is the property that makes the system "not a central database."

### The trustless-verification flow

Any third party can independently confirm results with only the HCS topic ID and
the published verification key(s):

```
verifyTally(topicId):
  1. Fetch all messages for topicId from a Mirror Node (public), in
     consensus-timestamp order.
  2. Take the first valid `poll_created` from an authorized creator key
     (see F6) as the poll definition: {merkleRoot, choices, startsAt,
     endsAt, idosConfig?, vkey selector}.
  3. seenNullifiers = {}; seenCredNullifiers = {}; counts = {}
  4. For each subsequent `vote` message, in order:
       a. REJECT if consensus_ts < startsAt or > endsAt.
       b. REJECT if choiceIndex not in [0, choices.length).
       c. REJECT if snarkjs.groth16.verify(vkey, publicSignals, proof) is false.
       d. Bind the envelope to the proof (F3):
            REJECT if nullifier            != publicSignals[NULLIFIER_IDX]
            REJECT if choiceIndex          != publicSignals[CHOICE_IDX]
            REJECT if publicSignals[ROOT_IDX] != poll.merkleRoot
            (credential polls: also credentialNullifier   == publicSignals[4]
                               and  credentialMerkleRoot  == idosConfig.credentialMerkleRoot (publicSignals[3]))
       e. REJECT if nullifier already in seenNullifiers
            (credential polls: also credentialNullifier unseen).
       f. ACCEPT: record nullifiers; counts[choiceIndex] += 1.
  5. Output counts. This must byte-for-byte match the indexer's published tally.
```

Every rule in steps 4a–4f already lives in `indexer/src/handler.ts`; the flow
above simply makes it a **standalone, dependency-light verifier** that does not
trust the indexer. Ship it as `packages/core` (or a small CLI) so results are
reproducible by anyone.

### Consequences / what to add

- **Publish the verification key(s)** and the exact tally rules (this section) as
  part of poll metadata or a well-known URL, so verification is turnkey.
- **Censorship resistance:** votes must be submitted **directly to HCS** (or via a
  relayer that cannot selectively drop them — allow direct-submit fallback and/or
  multiple relayers). The indexer can then only mis-*report*, never suppress, and
  mis-reporting is detectable by replay.
- **Optional:** periodic signed **tally checkpoints** (a Merkle root of accepted
  nullifiers at sequence N) so light clients can verify inclusion without a full
  replay.
- **"I voted" receipt (optional, orthogonal):** a soulbound POAP-style badge is
  fine as UX candy but is *not* part of the integrity story, and it publicly links
  an account to *participation* in a poll (not the choice), slightly shrinking the
  anonymity set. Keep it opt-in.

---

## Decision 3 — Embedded non-custodial wallet (MPC + device passkey + relayed fees)

### Context

The client will be a mobile app (iOS + Android). The wallet must sign (a) an
ownership challenge, (b) the deterministic nullifier-secret derivation, and
(c) — optionally — the HCS submission. We compared a **custodial omnibus /
exchange model** (backend holds keys, signs for users) against a **fully embedded
non-custodial wallet**.

### Decision

**Use an embedded, non-custodial wallet: keys (or key shares) generated and held
on-device in the Secure Enclave / StrongBox, unlocked by biometrics, with MPC/
threshold social recovery and no seed phrase. Fees are paid by a server-side
relayer (fee payer), so voters never need to hold HBAR.** Reject the custodial
omnibus model.

### Rationale

- **The omnibus/exchange model breaks Ballot's entire premise.** If the backend
  signs on the user's behalf it sees `identity → choice` in plaintext for every
  voter — the exact thing the ZK layer exists to hide — and it can forge votes for
  any user. It also pulls custody/regulatory (MSB/VASP, KYC) obligations and
  creates a single catastrophic key-honeypot.
- **The wallet here is essentially a signer, not a bank.** Because vote integrity
  comes from the ZK proof (not the paying Hedera account), fees can be relayed and
  users need no balance — we get exchange-grade onboarding without custody.
- **Embedded MPC + passkey gives the same "log in with Face ID" UX** as an exchange
  while keeping signing on-device, preserving anonymity and non-custody.

### Implementation notes (Hedera specifics)

- **Prefer ED25519 keys.** They are native to Hedera *and* deterministic — required
  because the nullifier secret is derived from a signature/derivation and must be
  **byte-identical every time** (F2). ECDSA is not deterministic unless RFC-6979 is
  guaranteed by the provider. Even better: derive the secret via a fixed HKDF path
  over stable key material (or store a per-user secret in the encrypted MPC backup)
  rather than relying on signature determinism.
- **Gasless voting:** set the relayer/operator as the transaction **fee payer** for
  `TopicMessageSubmit`; the device signs only the ownership challenge and generates
  the proof locally. Topic messages need no submit key by default, so the voter's
  account need not sign the submission at all.
- **Account bootstrap:** operator-funded auto-create (HIP-583 alias) so first launch
  costs the user nothing.
- **Progressive custody:** default everyone to the embedded wallet; also expose
  Hedera WalletConnect / HashPack for crypto-native "bring your own wallet" users,
  and allow key export for power users.
- **Provider candidates:** evaluate Web3Auth, Magic, Turnkey on native ED25519,
  deterministic signing, passkey support, and *structural non-custody* (the provider
  must not be able to reconstruct the key alone).

### Consequences

- `app/src/lib/idos.ts` already derives `credentialSecret` from `walletSign(...)`;
  this must move behind the embedded-wallet signer and use a deterministic scheme
  (see F2).
- A **relayer service** is a new component (fee payer + submit endpoint) that must
  be non-censoring (see Decision 2).

---

## Known flaws & remediations

These are the concrete defects in the current implementation (Phases 1–6) that
the decisions above are chosen to close.

| ID | Severity | Flaw | Remediation |
|---|---|---|---|
| **F1** | 🔴 Critical | **No ownership proof.** The eligible `serials[]` are published publicly in `poll_created`; the circuit only proves "I know a serial in the set," which everyone does. Anyone can vote with any serial. | Bind an **ownership signature** into the proof: the leaf becomes a commitment to the voter's key (Decision 1), and the circuit requires a signature/knowledge-of-key over a poll-specific challenge. Non-holders can no longer produce a valid proof. |
| **F2** | 🔴 Critical | **Unlimited double-voting.** `nullifier = Poseidon(serial, secret)` where `secret` is a random value the voter picks (`getOrCreateSecret`, localStorage). One serial → unlimited nullifiers by choosing new secrets. | Make the secret **deterministic and identity-bound** — derived once from the wallet key via a fixed HKDF/derivation (Decision 3), never voter-chosen. One identity ⇒ exactly one nullifier per poll. |
| **F3** | 🔴 Critical | **Envelope not bound to the proof.** In the non-credential path, `handler.ts` never checks `vote.nullifier == publicSignals[1]` or `vote.choiceIndex == publicSignals[2]`; the credential path also never binds `publicSignals[3]` (credentialMerkleRoot) to the poll's committed credential root. An attacker can resubmit one valid proof with a fresh `nullifier` (bypassing the UNIQUE dedup → multi-count), a different `choiceIndex` (miscount), or a proof against a foreign credential set. | In `handler.ts`, assert every trusted envelope field equals its `publicSignals` slot **before** dedup/insert: `nullifier`, `choiceIndex`, `publicSignals[ROOT_IDX] == poll.merkle_root`, and — for credential polls — `credentialNullifier == publicSignals[4]` and `credentialMerkleRoot == publicSignals[3]`. Encoded as step 4d in the verifier (Decision 2). |
| **F4** | 🟠 High | **Privacy leak via merkle-proof endpoint.** `fetchMerkleProof(topicId, serial)` sends the serial in cleartext to the indexer, which can correlate it (by timing/IP) with the resulting vote. | Generate the Merkle proof **client-side** from the `serials[]`/commitments already in `poll_created`. The indexer never learns the serial. Remove/deprecate the server-side proof endpoints. |
| **F5** | 🟠 High | **Unauthenticated poll creation + open CORS.** `/api/create-poll` has no auth or rate limit and spends the operator's HBAR per call; the indexer sets `Access-Control-Allow-Origin: *`. Trivial fund-drain / DoS. | Gate `/api/create-poll` with an API key (`CREATE_POLL_API_KEY`, `Authorization: Bearer`) and a per-client fixed-window rate limiter, both checked before any Hedera work. Scope the indexer's CORS to `ALLOWED_ORIGINS` (unset ⇒ permissive `*` for the read-only endpoints). A wallet-signature creator gate supersedes the API key once the wallet lands (Decision 3). |
| **F6** | 🟠 High | **Forgeable polls.** HCS poll topics have no submit key, so anyone who knows a topic ID can inject a fake `poll_created`/`vote` message. | **Two layers:** (a) set an HCS **submit key** on poll topics at creation so only the operator can publish to them — this closes the exploit at the ledger but means votes must be relayed by the operator (Decision 3), since a single topic can't grant per-message-type access; (b) the indexer independently **authorizes `poll_created` by payer account** (Mirror Node attests `payer_account_id`), rejecting definitions not from the configured `BALLOT_CREATOR_ACCOUNT_ID` — defense-in-depth that also protects legacy topics created without a submit key. The trustless verifier (Decision 2, step 2) applies the same payer check. |
| **F7** | 🟡 Medium | **idOS is a stub.** `app/src/lib/idos.ts` reads `NEXT_PUBLIC_DEV_CREDENTIAL_ID` instead of calling the SDK; credential-gated polls don't work end-to-end. | Wire `@idos-network/idos-sdk` behind the embedded-wallet signer (Decision 3); depends on the wallet work. |
| **F8** | 🟡 Low/ops | Verifier reads vkey from the filesystem and throws if absent (breaks CI/fresh deploy); subscriber is a best-effort 5s poller. | Bundle/publish vkeys as artifacts (also enables Decision 2's public verification); document the polling/liveness guarantees. |

### Fix ordering

1. **F3** (envelope binding) — smallest change, closes a critical multi-count hole immediately.
2. **F4** (client-side Merkle proof) — removes the privacy leak; also unblocks Decision 2's "indexer is untrusted" stance.
3. **F1 + F2** (ownership proof + deterministic secret) — the circuit + wallet work; the substantive integrity fix. Couples with Decisions 1 and 3.
4. **F6, F5** — topic submit keys and endpoint hardening.
5. **F7, F8** — idOS wiring and ops, after the wallet lands.

---

## Open questions

- **Is the gating NFT a real community asset, or eligibility-only?** Picks the
  Decision 1 branch (snapshot-real-NFT vs. commitment-tree ACL). Assumed
  eligibility-only unless stated otherwise.
- **Registration UX for commitment trees:** who submits commitments and when
  (self-registration window vs. issuer-provided list)?
- **Relayer trust/liveness:** single relayer vs. permissionless direct submission
  vs. multiple relayers — affects the censorship-resistance claim in Decision 2.
- **Coercion-resistance:** do we ever need MACI-style key-change/re-vote? Out of
  scope for v1; revisit if required.
