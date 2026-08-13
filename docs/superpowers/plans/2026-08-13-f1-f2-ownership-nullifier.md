# F1/F2 Ownership Proof + Deterministic Nullifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace serial-based, voter-chosen-secret voting with identity-commitment voting so eligibility requires proven NFT ownership (F1) and each identity votes exactly once per poll via a deterministic nullifier (F2).

**Architecture:** A wallet-derived identity secret produces a public commitment. NFT holders register that commitment (Hedera-signed) on a public HCS registry topic. A poll's Merkle tree is built from `Poseidon(commitment, weight)` leaves of registered holders. A new `vote_v2` circuit proves knowledge of the secret behind an in-tree leaf and emits a deterministic `Poseidon(secret, pollId)` nullifier plus a public `weight`; the indexer verifies, dedupes on nullifier, and tallies by summing weight.

**Tech Stack:** Circom 2.1.6 + snarkjs (Groth16, Poseidon), TypeScript, `poseidon-lite`, `@hashgraph/sdk` (Ed25519 verify), better-sqlite3, Vitest (core/indexer), Mocha + circom_tester (circuits), Next.js 14 (app).

## Global Constraints

- `TREE_DEPTH = 10` — hardcoded in `packages/core/src/merkle.ts`, `circuits/src/vote_v2.circom`. Must stay in sync (existing invariant).
- **Poseidon hashing only** (off-circuit root must equal in-circuit root). Never SHA-256 in the tree.
- `r` (BN254 scalar field order) = `21888242871839275222246405745257275088548364400416034343698204186575808495617n`. All field elements are `< r`.
- `pathIndices` convention: `0` = current node is left child, `1` = current is right child (matches `MerkleVerifier.circom` and `getProof`).
- `@ballot/core` must build before `app`/`indexer` (Turborepo `dependsOn: ["^build"]`). After editing core, run `pnpm --filter @ballot/core build` before dependents typecheck.
- Indexer tests set `process.env.DB_PATH = ":memory:"` **before** importing the module under test.
- Indexer verifiers must **never throw** — return `false` on config/verify errors (F8 pattern).
- Vote/poll authenticity checks from F3/F6 remain: envelope fields bound to `publicSignals`; `poll_created` payer-authorized via `BALLOT_CREATOR_ACCOUNT_ID`.
- Credential-gated polls (`idosConfig`) are **disabled** in this plan (deferred to F7). Poll creation rejects `idosConfig`; the indexer ignores it.
- Commit after every task. Branch: `design/f1-f2-ownership-nullifier` (already checked out).

## Domain / hashing definitions (used throughout)

- `IDENTITY_DOMAIN = 1n` (domain tag for secret derivation).
- `secret = Poseidon([IDENTITY_DOMAIN, bytesToField(seed)])` where `bytesToField(seed) = bigIntFromBytes(seed) mod r`.
- `commitment = Poseidon([secret])`.
- `nullifier = Poseidon([secret, pollId])`.
- `leaf = Poseidon([commitment, weight])`.
- `pollId = pollIdFromTopic(topicId)`: parse a Hedera topic id `"<shard>.<realm>.<num>"`; require `shard` and `realm` to be `0` (all user topics on the target network are `0.0.x`) and return `BigInt(num)`. Throw on non-`0.0.x` input. (Documented assumption; unique per network.)
- `registrationMessage(accountId, commitment) = "ballot-register-v1:" + accountId + ":" + commitment` (UTF-8 bytes are what gets signed).

---

## Phase 1 — Crypto foundations (core + circuit)

### Task 1: Identity crypto helpers in `@ballot/core`

**Files:**
- Create: `packages/core/src/identity.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./identity.js";`)
- Test: `packages/core/src/identity.test.ts`

**Interfaces:**
- Produces: `FIELD_ORDER: bigint`, `deriveIdentitySecret(seed: Uint8Array): bigint`, `identityCommitment(secret: bigint): bigint`, `voteNullifier(secret: bigint, pollId: bigint): bigint`, `pollIdFromTopic(topicId: string): bigint`, `registrationMessage(accountId: string, commitment: string): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/identity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { poseidon1, poseidon2 } from "poseidon-lite";
import {
  FIELD_ORDER,
  deriveIdentitySecret,
  identityCommitment,
  voteNullifier,
  pollIdFromTopic,
  registrationMessage,
} from "./identity.js";

const seed = new Uint8Array(32).fill(7);

describe("deriveIdentitySecret", () => {
  it("is deterministic and in-field", () => {
    const a = deriveIdentitySecret(seed);
    const b = deriveIdentitySecret(new Uint8Array(32).fill(7));
    expect(a).toBe(b);
    expect(a < FIELD_ORDER).toBe(true);
  });
  it("differs for different seeds", () => {
    expect(deriveIdentitySecret(seed)).not.toBe(
      deriveIdentitySecret(new Uint8Array(32).fill(8))
    );
  });
});

describe("identityCommitment / voteNullifier", () => {
  it("commitment = Poseidon([secret])", () => {
    const s = deriveIdentitySecret(seed);
    expect(identityCommitment(s)).toBe(poseidon1([s]));
  });
  it("nullifier = Poseidon([secret, pollId]) and binds pollId", () => {
    const s = deriveIdentitySecret(seed);
    expect(voteNullifier(s, 5n)).toBe(poseidon2([s, 5n]));
    expect(voteNullifier(s, 5n)).not.toBe(voteNullifier(s, 6n));
  });
});

describe("pollIdFromTopic", () => {
  it("returns the numeric tail for 0.0.x", () => {
    expect(pollIdFromTopic("0.0.12345")).toBe(12345n);
  });
  it("throws on non-0.0.x", () => {
    expect(() => pollIdFromTopic("1.2.3")).toThrow();
  });
});

describe("registrationMessage", () => {
  it("is domain-separated and includes account + commitment", () => {
    expect(registrationMessage("0.0.9", "42")).toBe("ballot-register-v1:0.0.9:42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/identity.test.ts`
Expected: FAIL — cannot find module `./identity.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/identity.ts`:
```ts
/**
 * Identity crypto for ownership-proof voting (F1/F2).
 * Pure, poseidon-lite only — shared by app, indexer, and circuit tests.
 */
import { poseidon1, poseidon2 } from "poseidon-lite";

/** BN254 scalar field order — all field elements must be < this. */
export const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Domain tag separating identity-secret derivation from other hashes. */
const IDENTITY_DOMAIN = 1n;

function bytesToField(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc % FIELD_ORDER;
}

/** Deterministic identity secret from a 32-byte seed. */
export function deriveIdentitySecret(seed: Uint8Array): bigint {
  return poseidon1([poseidon2([IDENTITY_DOMAIN, bytesToField(seed)])]);
}

/** Public identity commitment = Poseidon([secret]). */
export function identityCommitment(secret: bigint): bigint {
  return poseidon1([secret]);
}

/** Per-poll nullifier = Poseidon([secret, pollId]) — deterministic, one per identity per poll. */
export function voteNullifier(secret: bigint, pollId: bigint): bigint {
  return poseidon2([secret, pollId]);
}

/**
 * Derive a field-element poll id from a Hedera topic id.
 * Assumes user topics are "0.0.<num>"; throws otherwise.
 */
export function pollIdFromTopic(topicId: string): bigint {
  const m = /^0\.0\.(\d+)$/.exec(topicId.trim());
  if (!m) throw new Error(`Unsupported topic id for pollId: ${topicId} (expected 0.0.<num>)`);
  return BigInt(m[1]);
}

/** Canonical message a holder signs (Hedera key) to register their commitment. */
export function registrationMessage(accountId: string, commitment: string): string {
  return `ballot-register-v1:${accountId}:${commitment}`;
}
```

Add to `packages/core/src/index.ts` (after the existing exports):
```ts
export * from "./identity.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/identity.test.ts`
Expected: PASS (4 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity.ts packages/core/src/identity.test.ts packages/core/src/index.ts
git commit -m "feat(core): identity crypto helpers for F1/F2 (secret, commitment, nullifier, pollId)"
```

---

### Task 2: Commitment-leaf Merkle helpers in `@ballot/core`

**Files:**
- Modify: `packages/core/src/merkle.ts` (add two functions near `buildCircuitMerkleProof`)
- Test: `packages/core/src/merkle.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `buildFixedTree`, `getRoot`, `getProof`, `hashPair` from `merkle.ts`.
- Produces: `hashCommitmentLeaf(commitment: bigint, weight: bigint): bigint`, `buildCommitmentMerkleProof(leaves: { commitment: string; weight: string }[], myCommitment: string): { merkleRoot: string; leafIndex: number; pathElements: string[]; pathIndices: number[] }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/merkle.test.ts`:
```ts
import { hashCommitmentLeaf, buildCommitmentMerkleProof } from "./merkle.js";

describe("buildCommitmentMerkleProof", () => {
  const leaves = [
    { commitment: "11", weight: "1" },
    { commitment: "22", weight: "1" },
    { commitment: "33", weight: "1" },
  ];

  function rootFromInputs(commitment: string, weight: string, pathElements: string[], pathIndices: number[]) {
    let cur = hashCommitmentLeaf(BigInt(commitment), BigInt(weight));
    for (let i = 0; i < pathElements.length; i++) {
      const sib = BigInt(pathElements[i]);
      cur = pathIndices[i] === 0 ? hashPair(cur, sib) : hashPair(sib, cur);
    }
    return cur.toString();
  }

  it("authenticates every member against the root", () => {
    for (const l of leaves) {
      const p = buildCommitmentMerkleProof(leaves, l.commitment);
      expect(p.pathElements).toHaveLength(TREE_DEPTH);
      expect(rootFromInputs(l.commitment, l.weight, p.pathElements, p.pathIndices)).toBe(p.merkleRoot);
    }
  });

  it("throws for a non-member commitment", () => {
    expect(() => buildCommitmentMerkleProof(leaves, "999")).toThrow(/not in the eligible set/);
  });
});
```
(`hashPair`, `TREE_DEPTH` are already imported at the top of this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/merkle.test.ts`
Expected: FAIL — `hashCommitmentLeaf`/`buildCommitmentMerkleProof` not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/merkle.ts`, add after `buildCircuitMerkleProof`:
```ts
/** Leaf hash for a commitment-weight pair: Poseidon(commitment, weight). */
export function hashCommitmentLeaf(commitment: bigint, weight: bigint): bigint {
  return hashPair(commitment, weight);
}

/**
 * Build circuit-ready Merkle inputs for a voter's own commitment within a poll's
 * eligible leaf set. Leaves are hashed as Poseidon(commitment, weight). Runs
 * client-side so the voter never reveals which leaf is theirs.
 * Throws if `myCommitment` is not present.
 */
export function buildCommitmentMerkleProof(
  leaves: { commitment: string; weight: string }[],
  myCommitment: string
): { merkleRoot: string; leafIndex: number; pathElements: string[]; pathIndices: number[] } {
  const idx = leaves.findIndex((l) => l.commitment === myCommitment);
  if (idx === -1) throw new Error(`Commitment ${myCommitment} is not in the eligible set`);
  const leafHashes = leaves.map((l) => hashCommitmentLeaf(BigInt(l.commitment), BigInt(l.weight)));
  const layers = buildFixedTree(leafHashes);
  const rawProof = getProof(layers, idx);
  return {
    merkleRoot: getRoot(layers),
    leafIndex: idx,
    pathElements: rawProof.map((p) => p.sibling),
    pathIndices: rawProof.map((p) => (p.direction === "left" ? 1 : 0)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/merkle.test.ts`
Expected: PASS (all existing + the new describe block).

- [ ] **Step 5: Build core + commit**

```bash
pnpm --filter @ballot/core build
git add packages/core/src/merkle.ts packages/core/src/merkle.test.ts
git commit -m "feat(core): commitment-weight Merkle leaf + client proof builder (F1/F2)"
```

---

### Task 3: `vote_v2.circom` circuit + tests, retire `vote.circom`

**Files:**
- Create: `circuits/src/vote_v2.circom`
- Delete: `circuits/src/vote.circom`, `circuits/test/vote.test.js`
- Modify: `circuits/scripts/compile.sh`, `circuits/scripts/setup.sh` (replace `vote` with `vote_v2`)
- Modify: `circuits/test/helpers.js` (add v2 helpers)
- Test: `circuits/test/vote_v2.test.js`

**Interfaces:**
- Produces circuit `Vote_v2(10)` with public `[merkleRoot, nullifierHash, choiceIndex, pollId, weight]`, private `[identitySecret, pathElements[10], pathIndices[10]]`; build artifacts `vote_v2.wasm`, `vote_v2_final.zkey`, `vote_v2.vkey.json`.
- Produces helper `computeCommitmentLeaf(commitment, weight)`, `computeIdentity(seedField)` in `helpers.js` for tests.

- [ ] **Step 1: Write the circuit**

Create `circuits/src/vote_v2.circom`:
```circom
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/merkle.circom";

// Ownership-proof vote (F1/F2). Proves:
//   1. commitment = Poseidon(identitySecret)
//   2. leaf = Poseidon(commitment, weight) is in the eligible Merkle tree
//   3. nullifierHash = Poseidon(identitySecret, pollId)  (deterministic, one/identity/poll)
//   4. choiceIndex is 8-bit; weight is 64-bit
//
// Public:  merkleRoot, nullifierHash, choiceIndex, pollId, weight
// Private: identitySecret, pathElements[], pathIndices[]
template Vote_v2(depth) {
    signal input merkleRoot;
    signal input nullifierHash;
    signal input choiceIndex;
    signal input pollId;
    signal input weight;

    signal input identitySecret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // 1. commitment = Poseidon(identitySecret)
    component commit = Poseidon(1);
    commit.inputs[0] <== identitySecret;

    // 2. leaf = Poseidon(commitment, weight)
    component leafHash = Poseidon(2);
    leafHash.inputs[0] <== commit.out;
    leafHash.inputs[1] <== weight;

    // 3. Merkle membership
    component merkle = MerkleVerifier(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i]  <== pathIndices[i];
    }
    merkle.root === merkleRoot;

    // 4. nullifier = Poseidon(identitySecret, pollId)
    component nul = Poseidon(2);
    nul.inputs[0] <== identitySecret;
    nul.inputs[1] <== pollId;
    nul.out === nullifierHash;

    // 5. range checks
    component cbits = Num2Bits(8);
    cbits.in <== choiceIndex;
    component wbits = Num2Bits(64);
    wbits.in <== weight;
}

// depth=10 matches TREE_DEPTH in packages/core/src/merkle.ts
component main {public [merkleRoot, nullifierHash, choiceIndex, pollId, weight]} = Vote_v2(10);
```

- [ ] **Step 2: Add circuit test helpers**

In `circuits/test/helpers.js`, add before `module.exports` and include in the export object:
```js
// --- vote_v2 helpers (F1/F2) ---
const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const IDENTITY_DOMAIN = 1n;

function identitySecretFromField(seedField) {
  return poseidon1([poseidon2([IDENTITY_DOMAIN, BigInt(seedField) % FIELD_ORDER])]);
}
function identityCommitment(secret) {
  return poseidon1([secret]);
}
function commitmentLeaf(commitment, weight) {
  return poseidon2([BigInt(commitment), BigInt(weight)]);
}
function voteNullifier(secret, pollId) {
  return poseidon2([secret, BigInt(pollId)]);
}
/** Build a fixed tree from precomputed leaf hashes (bigint[]). */
function buildFixedTreeFromLeaves(leafHashes) {
  const size = 2 ** TREE_DEPTH;
  const leaves = leafHashes.slice();
  while (leaves.length < size) leaves.push(ZERO_LEAF);
  const layers = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }
    layers.push(next);
    current = next;
  }
  return layers;
}
```
Update the `module.exports = { ... }` to also export: `FIELD_ORDER, identitySecretFromField, identityCommitment, commitmentLeaf, voteNullifier, buildFixedTreeFromLeaves`.

- [ ] **Step 3: Write the failing circuit test**

Create `circuits/test/vote_v2.test.js`:
```js
const path = require("path");
const assert = require("assert");
const { wasm: wasm_tester } = require("circom_tester");
const {
  identitySecretFromField,
  identityCommitment,
  commitmentLeaf,
  voteNullifier,
  buildFixedTreeFromLeaves,
  getRoot,
  getMerkleProof,
} = require("./helpers");

const CIRCUIT_PATH = path.join(__dirname, "../src/vote_v2.circom");
const BUILD_DIR = path.join(__dirname, "../build");

const POLL_ID = 12345n;
const WEIGHT = 1n;

let circuit, layers, merkleRoot, pathElements, pathIndices, secret, commitment, nullifier;

before(async function () {
  this.timeout(60_000);
  circuit = await wasm_tester(CIRCUIT_PATH, { output: BUILD_DIR, recompile: false });

  secret = identitySecretFromField("777");
  commitment = identityCommitment(secret);
  // three eligible identities; voter is index 0
  const commitments = [commitment, identityCommitment(identitySecretFromField("2")), identityCommitment(identitySecretFromField("3"))];
  const leafHashes = commitments.map((c) => commitmentLeaf(c, WEIGHT));
  layers = buildFixedTreeFromLeaves(leafHashes);
  merkleRoot = getRoot(layers);
  ({ pathElements, pathIndices } = getMerkleProof(layers, 0));
  nullifier = voteNullifier(secret, POLL_ID);
});

function validInput(overrides = {}) {
  return {
    merkleRoot, nullifierHash: nullifier, choiceIndex: 1, pollId: POLL_ID, weight: WEIGHT,
    identitySecret: secret, pathElements, pathIndices, ...overrides,
  };
}

describe("vote_v2.circom", () => {
  it("accepts a valid proof", async () => {
    const w = await circuit.calculateWitness(validInput(), true);
    await circuit.checkConstraints(w);
  });
  it("rejects a wrong secret (membership fails)", async () => {
    await assert.rejects(() =>
      circuit.calculateWitness(validInput({ identitySecret: identitySecretFromField("42") }), true)
    );
  });
  it("rejects a tampered weight (leaf/root mismatch)", async () => {
    await assert.rejects(() => circuit.calculateWitness(validInput({ weight: 5n }), true));
  });
  it("rejects a mismatched nullifier", async () => {
    await assert.rejects(() =>
      circuit.calculateWitness(validInput({ nullifierHash: voteNullifier(secret, 999n) }), true)
    );
  });
  it("rejects choiceIndex = 256 (exceeds 8 bits)", async () => {
    await assert.rejects(() => circuit.calculateWitness(validInput({ choiceIndex: 256 }), true));
  });
});
```

- [ ] **Step 4: Update build scripts (swap vote → vote_v2), delete old circuit**

In `circuits/scripts/compile.sh`, replace the `vote.circom` compile block with:
```bash
echo "==> Compiling vote_v2.circom"
circom "$CIRCUITS_DIR/src/vote_v2.circom" \
  --r1cs --wasm --sym \
  -l "$LIB_DIR" \
  -o "$BUILD_DIR"
```
In `circuits/scripts/setup.sh`, change the loop line:
```bash
for CIRCUIT in membership vote_v2 vote_with_credential; do
```
Then remove the retired files:
```bash
git rm circuits/src/vote.circom circuits/test/vote.test.js
```

- [ ] **Step 5: Compile, setup, run circuit test**

Run:
```bash
cd circuits && npm run compile && npm run setup && npx mocha --timeout 120000 test/vote_v2.test.js
```
Expected: compile + setup succeed; all 5 vote_v2 tests PASS.
(If `circom` is unavailable in this environment, mark this step blocked and note artifacts must be generated on a machine with circom before the indexer verifier tests can run against real proofs. The indexer tests in later tasks mock snarkjs and do not require artifacts.)

- [ ] **Step 6: Copy artifacts for app + indexer, commit**

```bash
cd circuits
mkdir -p ../app/public/circuits/vote_v2_js
cp build/vote_v2_js/vote_v2.wasm ../app/public/circuits/vote_v2_js/
cp build/vote_v2_final.zkey        ../app/public/circuits/
cp build/vote_v2.vkey.json         ../app/public/circuits/
cd ..
git add circuits/src/vote_v2.circom circuits/test/vote_v2.test.js circuits/test/helpers.js circuits/scripts/compile.sh circuits/scripts/setup.sh
git add -A circuits/src/vote.circom circuits/test/vote.test.js
git commit -m "feat(circuits): vote_v2 ownership-proof circuit; retire serial-based vote.circom (F1/F2)"
```

---

## Phase 2 — Types & registry (core + indexer)

### Task 4: Envelope + registry types in `@ballot/core`

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/src/types.test.ts` (new — compile-level assertions)

**Interfaces:**
- Produces: `HCSRegisterMessage`, `RegistryEntry`; `HCSPollMessage.leaves?: PollLeaf[]`; `HCSVoteMessage.weight: string`; `PollLeaf = { commitment: string; weight: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { HCSRegisterMessage, HCSPollMessage, HCSVoteMessage, PollLeaf } from "./index.js";

describe("new envelope types", () => {
  it("HCSRegisterMessage shape", () => {
    const m: HCSRegisterMessage = {
      type: "register", accountId: "0.0.9", commitment: "42", signature: "ab", ts: "1",
    };
    expect(m.type).toBe("register");
  });
  it("poll leaves + vote weight compile", () => {
    const leaf: PollLeaf = { commitment: "1", weight: "1" };
    const poll: HCSPollMessage = {
      type: "poll_created", title: "t", choices: ["a", "b"], tokenId: "0.0.1",
      merkleRoot: "0", startsAt: "s", endsAt: "e", leaves: [leaf],
    };
    const vote: HCSVoteMessage = {
      type: "vote", pollTopicId: "0.0.2", choiceIndex: 0, nullifier: "n",
      weight: "1", proof: {} as any, publicSignals: [],
    };
    expect(poll.leaves?.[0].weight).toBe("1");
    expect(vote.weight).toBe("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/types.test.ts`
Expected: FAIL — types not defined / `weight` missing.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/types.ts`:

Add near the top (after `IdosConfig`):
```ts
/** One eligible identity in a poll's Merkle tree. */
export interface PollLeaf {
  /** Public identity commitment = Poseidon(secret). */
  commitment: string;
  /** Voting weight bound into the leaf (v1 always "1"). */
  weight: string;
}

/** HCS message: a holder binds their account to an identity commitment. */
export interface HCSRegisterMessage {
  type: "register";
  accountId: string;
  commitment: string;
  /** Ed25519 signature (hex) by the account key over registrationMessage(). */
  signature: string;
  ts?: string;
}

/** Derived registry entry (indexer view). */
export interface RegistryEntry {
  accountId: string;
  commitment: string;
  consensusTs: string;
}
```

In `HCSVoteMessage`, add after `nullifier`:
```ts
  /** Voting weight (public signal [4]); the tally sums this. v1 = "1". */
  weight: string;
```

In `HCSPollMessage`, add after `serials?`:
```ts
  /** Eligible identity commitments + weights (F1/F2). Replaces serials for new polls. */
  leaves?: PollLeaf[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Build core + commit**

```bash
pnpm --filter @ballot/core build
git add packages/core/src/types.ts packages/core/src/types.test.ts
git commit -m "feat(core): register/poll-leaf/vote-weight envelope types (F1/F2)"
```

---

### Task 5: DB schema — registrations table + vote weight + weighted tally

**Files:**
- Modify: `indexer/src/db.ts`
- Test: `indexer/src/db.test.ts` (append)

**Interfaces:**
- Consumes: `RegistryEntry` from `@ballot/core`.
- Produces: `upsertRegistration(r: { accountId: string; commitment: string; consensusTs: string }): void`, `getRegistration(accountId: string): { commitment: string; consensus_ts: string } | undefined`, `getAllRegistrations(): { account_id: string; commitment: string }[]`; `insertVote` accepts `weight: string`; `getTally` sums weight.

- [ ] **Step 1: Write the failing test**

Append to `indexer/src/db.test.ts` (top of file already sets `process.env.DB_PATH = ":memory:"` before import; reuse that import):
```ts
import { upsertRegistration, getRegistration, getAllRegistrations } from "./db.js";

describe("registrations", () => {
  it("upserts latest-wins by consensus ts and reads back", () => {
    upsertRegistration({ accountId: "0.0.5", commitment: "aaa", consensusTs: "100.0" });
    upsertRegistration({ accountId: "0.0.5", commitment: "bbb", consensusTs: "200.0" });
    expect(getRegistration("0.0.5")?.commitment).toBe("bbb");
    // stale update ignored
    upsertRegistration({ accountId: "0.0.5", commitment: "ccc", consensusTs: "150.0" });
    expect(getRegistration("0.0.5")?.commitment).toBe("bbb");
    expect(getAllRegistrations().some((r) => r.account_id === "0.0.5")).toBe(true);
  });
});
```
Append a weighted-tally test (uses existing `insertPoll`/`insertVote` helpers — check the file's existing imports and add `insertVote`, `getTally`, `insertPoll` if not already imported):
```ts
import { insertPoll, insertVote, getTally } from "./db.js";

describe("weighted tally", () => {
  it("sums weight per choice", () => {
    insertPoll({
      topicId: "0.0.7", title: "w", choices: ["A", "B"], tokenId: "0.0.1",
      merkleRoot: "0", startsAt: "2026-01-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z",
    });
    insertVote({ topicId: "0.0.7", choiceIndex: 0, nullifier: "n1", weight: "3", proof: "{}", publicSignals: [] });
    insertVote({ topicId: "0.0.7", choiceIndex: 0, nullifier: "n2", weight: "2", proof: "{}", publicSignals: [] });
    const rows = getTally("0.0.7");
    expect(rows.find((r) => r.choiceIndex === 0)?.count).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd indexer && npx vitest run src/db.test.ts`
Expected: FAIL — `upsertRegistration` undefined; `insertVote` rejects `weight`; tally counts rows (2) not weight (5).

- [ ] **Step 3: Write minimal implementation**

In `indexer/src/db.ts`:

Add to the `migrate()` `db.exec(...)` schema (a new table + weight column in votes):
```sql
    CREATE TABLE IF NOT EXISTS registrations (
      account_id   TEXT PRIMARY KEY,
      commitment   TEXT NOT NULL,
      consensus_ts TEXT NOT NULL
    );
```
And add `weight` to the `votes` table definition (`weight TEXT NOT NULL DEFAULT '1'`). Also add to the idempotent ALTER list:
```ts
    "ALTER TABLE votes ADD COLUMN weight TEXT NOT NULL DEFAULT '1'",
```

Update `insertVote`'s signature type to include `weight: string` and its INSERT column list + values to include `weight` (place it alongside `choice_index`). Concretely change the prepared statement to include `weight` and pass `vote.weight ?? "1"`.

Change `getTally` to:
```ts
export function getTally(topicId: string): { choiceIndex: number; count: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT choice_index as choiceIndex, CAST(SUM(CAST(weight AS INTEGER)) AS INTEGER) as count
       FROM votes WHERE topic_id = ? AND verified = 1
       GROUP BY choice_index ORDER BY choice_index`
    )
    .all(topicId) as { choiceIndex: number; count: number }[];
}
```

Add registration functions:
```ts
export function upsertRegistration(r: { accountId: string; commitment: string; consensusTs: string }): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO registrations (account_id, commitment, consensus_ts)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       commitment = excluded.commitment,
       consensus_ts = excluded.consensus_ts
     WHERE excluded.consensus_ts > registrations.consensus_ts`
  ).run(r.accountId, r.commitment, r.consensusTs);
}

export function getRegistration(accountId: string): { commitment: string; consensus_ts: string } | undefined {
  const db = getDb();
  return db.prepare(`SELECT commitment, consensus_ts FROM registrations WHERE account_id = ?`).get(accountId) as
    | { commitment: string; consensus_ts: string }
    | undefined;
}

export function getAllRegistrations(): { account_id: string; commitment: string }[] {
  const db = getDb();
  return db.prepare(`SELECT account_id, commitment FROM registrations`).all() as
    { account_id: string; commitment: string }[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd indexer && npx vitest run src/db.test.ts`
Expected: PASS (registrations latest-wins; tally sums to 5).

- [ ] **Step 5: Commit**

```bash
git add indexer/src/db.ts indexer/src/db.test.ts
git commit -m "feat(indexer): registrations table + vote weight column + weighted tally (F1/F2)"
```

---

### Task 6: Registry — verify Hedera-signed registration

**Files:**
- Create: `indexer/src/registry.ts`
- Test: `indexer/src/registry.test.ts`
- Modify: `indexer/package.json` (ensure `@hashgraph/sdk` dependency)

**Interfaces:**
- Consumes: `registrationMessage` from `@ballot/core`; `upsertRegistration` from `./db.js`.
- Produces: `verifyRegistration(msg: HCSRegisterMessage, accountKeyLookup: (id: string) => Promise<string | null>): Promise<boolean>` (verifies the Ed25519 signature against the account's public key), and `handleRegister(msg, timestamp, accountKeyLookup): Promise<void>` (verify → upsert).

- [ ] **Step 1: Ensure dependency**

Confirm `@hashgraph/sdk` is in `indexer/package.json` dependencies; if absent, add it:
```bash
cd indexer && pnpm add @hashgraph/sdk
```

- [ ] **Step 2: Write the failing test**

Create `indexer/src/registry.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { PrivateKey } from "@hashgraph/sdk";
import { registrationMessage } from "@ballot/core";

process.env.DB_PATH = ":memory:";
const { verifyRegistration } = await import("./registry.js");

const key = PrivateKey.generateED25519();
const pub = key.publicKey.toStringDer();
const ACCOUNT = "0.0.4242";
const COMMIT = "12345";

function sign(msg: string): string {
  return Buffer.from(key.sign(Buffer.from(msg, "utf-8"))).toString("hex");
}

const lookup = async (id: string) => (id === ACCOUNT ? pub : null);

describe("verifyRegistration", () => {
  it("accepts a valid signature by the account key", async () => {
    const sig = sign(registrationMessage(ACCOUNT, COMMIT));
    expect(await verifyRegistration({ type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: sig }, lookup)).toBe(true);
  });
  it("rejects a signature over a different commitment", async () => {
    const sig = sign(registrationMessage(ACCOUNT, "999"));
    expect(await verifyRegistration({ type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: sig }, lookup)).toBe(false);
  });
  it("rejects when the account key is unknown", async () => {
    const sig = sign(registrationMessage("0.0.1", COMMIT));
    expect(await verifyRegistration({ type: "register", accountId: "0.0.1", commitment: COMMIT, signature: sig }, lookup)).toBe(false);
  });
  it("rejects a malformed signature", async () => {
    expect(await verifyRegistration({ type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: "zz" }, lookup)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd indexer && npx vitest run src/registry.test.ts`
Expected: FAIL — cannot find `./registry.js`.

- [ ] **Step 4: Write minimal implementation**

Create `indexer/src/registry.ts`:
```ts
/**
 * Registration verification (F1): binds a Hedera account to an identity
 * commitment. A registration is valid only if signed by the account's key.
 */
import { PublicKey } from "@hashgraph/sdk";
import { registrationMessage } from "@ballot/core";
import type { HCSRegisterMessage } from "@ballot/core";
import { upsertRegistration } from "./db.js";

const MIRROR_BASE =
  process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";

/** Fetch an account's Ed25519 public key (DER/hex) from Mirror Node. */
export async function fetchAccountKey(accountId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { key?: { key?: string } };
    return data.key?.key ?? null;
  } catch {
    return null;
  }
}

/** Verify a registration's signature against the account's on-file key. */
export async function verifyRegistration(
  msg: HCSRegisterMessage,
  accountKeyLookup: (id: string) => Promise<string | null> = fetchAccountKey
): Promise<boolean> {
  try {
    const keyStr = await accountKeyLookup(msg.accountId);
    if (!keyStr) return false;
    const pub = PublicKey.fromString(keyStr);
    const message = Buffer.from(registrationMessage(msg.accountId, msg.commitment), "utf-8");
    const sig = Buffer.from(msg.signature, "hex");
    return pub.verify(message, sig);
  } catch {
    return false;
  }
}

/** Verify then record a registration (latest-wins on consensus timestamp). */
export async function handleRegister(
  msg: HCSRegisterMessage,
  timestamp: string,
  accountKeyLookup: (id: string) => Promise<string | null> = fetchAccountKey
): Promise<void> {
  if (!(await verifyRegistration(msg, accountKeyLookup))) {
    console.warn(`[registry] Rejected registration for ${msg.accountId} (bad signature or unknown key)`);
    return;
  }
  upsertRegistration({ accountId: msg.accountId, commitment: msg.commitment, consensusTs: timestamp });
  console.log(`[registry] Registered ${msg.accountId} -> ${msg.commitment}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd indexer && npx vitest run src/registry.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add indexer/src/registry.ts indexer/src/registry.test.ts indexer/package.json
git commit -m "feat(indexer): verify Hedera-signed account->commitment registrations (F1)"
```

---

### Task 7: Wire `register` messages through the handler + subscriber

**Files:**
- Modify: `indexer/src/handler.ts` (add `register` branch)
- Modify: `indexer/src/index.ts` (subscribe to the registry topic)
- Test: `indexer/src/handler.test.ts` (append a register describe block)

**Interfaces:**
- Consumes: `handleRegister` from `./registry.js`.
- Produces: `handleMessage` now dispatches `msg.type === "register"` to a registration path with an injectable `accountKeyLookup` (default real Mirror Node) for testability.

- [ ] **Step 1: Write the failing test**

Append to `indexer/src/handler.test.ts`:
```ts
import { PrivateKey } from "@hashgraph/sdk";
import { registrationMessage } from "@ballot/core";
import { getRegistration as dbGetRegistration } from "./db.js";

describe("handleMessage — register (F1)", () => {
  const key = PrivateKey.generateED25519();
  const ACCOUNT = "0.0.8888";
  const COMMIT = "55";
  const lookup = async (id: string) => (id === ACCOUNT ? key.publicKey.toStringDer() : null);

  it("records a valid registration", async () => {
    const sig = Buffer.from(key.sign(Buffer.from(registrationMessage(ACCOUNT, COMMIT), "utf-8"))).toString("hex");
    await handleMessage(
      "0.0.registry",
      { type: "register", accountId: ACCOUNT, commitment: COMMIT, signature: sig },
      "1000.0", noop, alwaysValid, alwaysValid,
      { accountKeyLookup: lookup }
    );
    expect(dbGetRegistration(ACCOUNT)?.commitment).toBe(COMMIT);
  });

  it("ignores an invalid registration", async () => {
    await handleMessage(
      "0.0.registry",
      { type: "register", accountId: "0.0.7777", commitment: "9", signature: "zz" },
      "1001.0", noop, alwaysValid, alwaysValid,
      { accountKeyLookup: lookup }
    );
    expect(dbGetRegistration("0.0.7777")).toBeUndefined();
  });
});
```
(`noop`, `alwaysValid` already exist in the file. The `opts` bag already carries `payerAccountId`/`trustedCreator`; this adds `accountKeyLookup`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd indexer && npx vitest run src/handler.test.ts`
Expected: FAIL — register branch not handled; registration not recorded.

- [ ] **Step 3: Write minimal implementation**

In `indexer/src/handler.ts`:

Add import:
```ts
import { handleRegister } from "./registry.js";
import type { HCSRegisterMessage } from "@ballot/core";
```
Extend the `opts` parameter type to include:
```ts
  opts: {
    payerAccountId?: string;
    trustedCreator?: string;
    accountKeyLookup?: (id: string) => Promise<string | null>;
  } = {}
```
Add a branch at the start of the type-dispatch (after `const msg = message as { type: string };`):
```ts
  if (msg.type === "register") {
    await handleRegister(message as HCSRegisterMessage, timestamp, opts.accountKeyLookup);
    return;
  }
```

In `indexer/src/index.ts`:

Add a registry topic env + subscription. After the `TRUSTED_CREATOR` block add:
```ts
const REGISTRY_TOPIC_ID = process.env.REGISTRY_TOPIC_ID;
if (!REGISTRY_TOPIC_ID) {
  console.warn("[indexer] REGISTRY_TOPIC_ID not set — account registrations will not be ingested (F1).");
}
```
After existing poll subscriptions, subscribe to the registry topic:
```ts
if (REGISTRY_TOPIC_ID) {
  subscriber.subscribe(REGISTRY_TOPIC_ID);
  console.log(`[indexer] Watching registry topic ${REGISTRY_TOPIC_ID}`);
}
```
(The message handler already forwards `payerAccountId`; leave `accountKeyLookup` at its default so the real Mirror Node fetch is used in production.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd indexer && npx vitest run src/handler.test.ts`
Expected: PASS (register cases + all existing handler tests).

- [ ] **Step 5: Commit**

```bash
git add indexer/src/handler.ts indexer/src/index.ts indexer/src/handler.test.ts
git commit -m "feat(indexer): ingest register messages via handler + registry topic subscription (F1)"
```

---

## Phase 3 — Vote verification & tally (indexer)

### Task 8: Point verifier at `vote_v2`; disable credential path

**Files:**
- Modify: `indexer/src/vkey.ts` (`voteVkeyPath` → `vote_v2.vkey.json`)
- Modify: `indexer/src/verifier.test.ts` (path assertion only if present; otherwise no change)

**Interfaces:**
- Produces: `voteVkeyPath()` returns the `vote_v2` key path.

- [ ] **Step 1: Update vkey path**

In `indexer/src/vkey.ts`, change `voteVkeyPath()`:
```ts
export function voteVkeyPath(): string {
  return (
    process.env.VKEY_PATH ||
    path.join(process.cwd(), "..", "circuits", "build", "vote_v2.vkey.json")
  );
}
```

- [ ] **Step 2: Run verifier + vkey tests**

Run: `cd indexer && npx vitest run src/verifier.test.ts src/vkey.test.ts`
Expected: PASS (these tests mock `node:fs`/`snarkjs`, so they don't depend on the filename value; confirm still green).

- [ ] **Step 3: Commit**

```bash
git add indexer/src/vkey.ts
git commit -m "chore(indexer): verify votes against vote_v2 vkey (F1/F2)"
```

---

### Task 9: Vote handling — pollId + weight binding, weighted insert, disable credential

**Files:**
- Modify: `indexer/src/handler.ts` (vote branch)
- Test: `indexer/src/handler.test.ts` (replace/extend the vote binding tests for the new signal set)

**Interfaces:**
- Consumes: `pollIdFromTopic` from `@ballot/core`; `insertVote({ ..., weight })` from `./db.js`.
- Produces: vote path binds `publicSignals = [merkleRoot, nullifier, choiceIndex, pollId, weight]`, rejects `idosConfig` polls, inserts `weight`.

- [ ] **Step 1: Write the failing test**

In `indexer/src/handler.test.ts`, add a v2 vote binding block. Use a helper that builds the 5-signal envelope:
```ts
import { pollIdFromTopic } from "@ballot/core";

describe("handleMessage — vote_v2 binding (F1/F2)", () => {
  const TOPIC = "0.0.6100";
  const POLL_ID = pollIdFromTopic(TOPIC).toString();
  const total = () => getTally(TOPIC).reduce((s, r) => s + r.count, 0);

  beforeAll(() => {
    insertPoll({
      topicId: TOPIC, title: "v2", choices: ["Yes", "No"], tokenId: "0.0.1",
      merkleRoot: "777", startsAt: STARTS_AT, endsAt: ENDS_AT,
    });
  });

  function v2Vote(nullifier: string, weight = "1", overrides: Partial<Record<"root"|"choice"|"pollId"|"weight", string>> = {}) {
    return {
      type: "vote" as const, pollTopicId: TOPIC, choiceIndex: 0, nullifier, weight,
      proof: fakeProof,
      publicSignals: [overrides.root ?? "777", nullifier, overrides.choice ?? "0", overrides.pollId ?? POLL_ID, overrides.weight ?? weight],
    };
  }

  it("accepts a well-formed v2 vote and tallies its weight", async () => {
    const before = total();
    await handleMessage(TOPIC, v2Vote("v2-a", "3"), TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before + 3);
  });
  it("rejects a pollId mismatch (cross-poll replay)", async () => {
    const before = total();
    await handleMessage(TOPIC, v2Vote("v2-b", "1", { pollId: "999999" }), TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before);
  });
  it("rejects a weight/publicSignals[4] mismatch", async () => {
    const before = total();
    await handleMessage(TOPIC, v2Vote("v2-c", "5", { weight: "1" }), TS_DURING, noop, alwaysValid);
    expect(total()).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd indexer && npx vitest run src/handler.test.ts`
Expected: FAIL — pollId/weight not bound; weight not summed.

- [ ] **Step 3: Write minimal implementation**

In `indexer/src/handler.ts` vote branch:

Add import:
```ts
import { pollIdFromTopic } from "@ballot/core";
```
After the existing F3 bindings (`publicSignals[0]===merkle_root`, `[1]===nullifier`, `[2]===String(choiceIndex)`), add:
```ts
    // pollId binding (cross-poll nullifier replay guard) — recomputed, never trusted from envelope.
    let expectedPollId: string;
    try {
      expectedPollId = pollIdFromTopic(vote.pollTopicId).toString();
    } catch {
      console.warn(`[indexer] Rejected: unsupported topic id for pollId ${vote.pollTopicId}`);
      return;
    }
    if (vote.publicSignals[3] !== expectedPollId) {
      console.warn(`[indexer] Rejected: pollId mismatch — publicSignals[3]=${vote.publicSignals[3]}, expected=${expectedPollId}`);
      return;
    }
    // weight binding
    if (String(vote.weight) !== vote.publicSignals[4]) {
      console.warn(`[indexer] Rejected: weight mismatch — envelope=${vote.weight}, publicSignals[4]=${vote.publicSignals[4]}`);
      return;
    }
```
Replace the credential branch. Where the code currently does `if (idosConfig) { ... verifyCredential ... } else { verify ... }`, change to reject credential polls and always use the base verifier:
```ts
    if (idosConfig) {
      console.warn(`[indexer] Rejected: credential-gated polls are disabled pending F7`);
      return;
    }
    const valid = await verify(vote.proof, vote.publicSignals);
    if (!valid) {
      console.warn(`[indexer] Rejected: invalid ZK proof for nullifier ${vote.nullifier}`);
      return;
    }
```
Update the `insertVote(...)` call to pass `weight`:
```ts
    const inserted = insertVote({
      topicId: vote.pollTopicId,
      choiceIndex: vote.choiceIndex,
      nullifier: vote.nullifier,
      weight: vote.weight ?? "1",
      proof: JSON.stringify(vote.proof),
      publicSignals: vote.publicSignals,
      consensusTs: timestamp,
    });
```
(Remove the now-unused `credentialNullifier` argument from this call.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd indexer && npx vitest run src/handler.test.ts`
Expected: PASS (v2 binding cases + all existing).

- [ ] **Step 5: Full indexer suite + commit**

```bash
cd indexer && npx vitest run
```
Expected: all files PASS.
```bash
git add indexer/src/handler.ts indexer/src/handler.test.ts
git commit -m "feat(indexer): bind pollId + weight, weighted insert, disable credential path (F1/F2)"
```

---

### Task 10: API — publish poll leaves + expose registry

**Files:**
- Modify: `indexer/src/api.ts`
- Modify: `indexer/src/handler.ts` (persist `leaves` on `poll_created`) and `indexer/src/db.ts` (`leaves` column) if not already carried
- Test: `indexer/src/api` covered via integration; add a focused `db` round-trip assertion

**Interfaces:**
- Produces: `GET /api/polls/:topicId` response includes `leaves: PollLeaf[]`; `GET /api/registry` returns `{ [accountId]: commitment }`.

- [ ] **Step 1: Persist leaves on poll_created**

In `indexer/src/db.ts`, add a `leaves TEXT` column to `polls` (schema + idempotent ALTER `"ALTER TABLE polls ADD COLUMN leaves TEXT"`), extend `insertPoll` to accept `leaves?: PollLeaf[]` and store `JSON.stringify(leaves)`.
In `indexer/src/handler.ts` `poll_created` branch, pass `leaves: poll.leaves` into `insertPoll`.

- [ ] **Step 2: Return leaves + registry from the API**

In `indexer/src/api.ts`, in the single-poll (`!wantProof`) response, parse and include leaves:
```ts
      const leaves = row.leaves ? (JSON.parse(row.leaves as string) as { commitment: string; weight: string }[]) : [];
      json(200, { ...pollWithTally(row), serials, leaves });
```
Add a registry route (before the poll route match):
```ts
  if (req.method === "GET" && path === "/api/registry") {
    const rows = getAllRegistrations() as { account_id: string; commitment: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.account_id] = r.commitment;
    json(200, map);
    return;
  }
```
Add the import: `import { getAllPolls, getPoll, getAllRegistrations } from "./db.js";`

- [ ] **Step 3: Verify via integration test**

Run: `cd indexer && npx vitest run src/integration.test.ts src/db.test.ts`
Expected: PASS (add/adjust an assertion in `integration.test.ts` if it asserts poll shape; leaves default to `[]`).

- [ ] **Step 4: Full suite + commit**

```bash
cd indexer && npx vitest run
git add indexer/src/api.ts indexer/src/db.ts indexer/src/handler.ts indexer/src/integration.test.ts
git commit -m "feat(indexer): publish poll leaves + expose account->commitment registry (F1/F2)"
```

---

## Phase 4 — App integration

> The app has no unit-test harness (per project setup). Each app task is verified with `cd app && npx tsc --noEmit` (expected clean) plus the described manual check. Keep changes typecheck-clean.

### Task 11: `IdentityProvider` (app)

**Files:**
- Create: `app/src/lib/identity.ts`

**Interfaces:**
- Consumes: `deriveIdentitySecret`, `identityCommitment`, `registrationMessage` from `@ballot/core`.
- Produces: `interface IdentityProvider`, `LocalIdentityProvider` (minimal impl), `getIdentityProvider(signer): IdentityProvider`.

- [ ] **Step 1: Implement the provider**

Create `app/src/lib/identity.ts`:
```ts
/**
 * Identity layer (F1/F2). Minimal impl: a random seed persisted in browser
 * storage; the embedded-wallet provider (Decision 3) replaces this behind the
 * same interface later. Recovery/MPC deferred.
 */
import { deriveIdentitySecret, identityCommitment, registrationMessage } from "@ballot/core";

export interface IdentityProvider {
  getIdentitySecret(): Promise<bigint>;
  getCommitment(): Promise<string>;
  signRegistration(): Promise<{ accountId: string; commitment: string; signature: string }>;
}

const SEED_KEY = "ballot_identity_seed_v1";

function loadOrCreateSeed(): Uint8Array {
  const stored = localStorage.getItem(SEED_KEY);
  if (stored) return Uint8Array.from(stored.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const seed = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SEED_KEY, Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join(""));
  return seed;
}

/**
 * @param accountId  the voter's Hedera account
 * @param signMessage signs a UTF-8 message with the account's Hedera key, returns hex signature
 */
export function getIdentityProvider(
  accountId: string,
  signMessage: (msg: string) => Promise<string>
): IdentityProvider {
  const secret = deriveIdentitySecret(loadOrCreateSeed());
  const commitment = identityCommitment(secret).toString();
  return {
    async getIdentitySecret() {
      return secret;
    },
    async getCommitment() {
      return commitment;
    },
    async signRegistration() {
      const signature = await signMessage(registrationMessage(accountId, commitment));
      return { accountId, commitment, signature };
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ballot/core build && cd app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/identity.ts
git commit -m "feat(app): IdentityProvider (seed -> secret -> commitment + registration signing) (F1/F2)"
```

---

### Task 12: Poll creation snapshot — holders ∩ registry → leaves

**Files:**
- Modify: `app/src/app/api/create-poll/route.ts`

**Interfaces:**
- Consumes: `GET /api/registry` (from Task 10); `hashCommitmentLeaf`, `buildFixedTree`, `getRoot` from `@ballot/core`.
- Produces: `poll_created` with `leaves: PollLeaf[]` + a `merkleRoot` over commitment leaves; rejects `idosConfig`.

- [ ] **Step 1: Implement snapshot changes**

In `app/src/app/api/create-poll/route.ts`:
- Reject credential polls: after body validation, if `idosConfig` is present, return `400 { error: "Credential-gated polls are temporarily disabled (pending F7)." }`.
- After `fetchNftSerials` obtains holder serials, also fetch holder **accounts**. Replace the serial fetch with an accounts+serials fetch: query Mirror Node `nfts` endpoint (which returns `account_id` per serial), collect the set of holder `account_id`s.
- Fetch the registry: `const registry = await (await fetch(`${INDEXER_URL}/api/registry`)).json() as Record<string,string>;` (use `process.env.INDEXER_URL` with the existing localhost fallback).
- Build the eligible leaf set: for each holder account present in `registry`, push `{ commitment: registry[account], weight: "1" }`. De-duplicate by commitment.
- If no eligible (registered) holders, return `400 { error: "No registered holders for this token. Voters must register before the snapshot." }`.
- Compute the root: `const leafHashes = leaves.map(l => hashCommitmentLeaf(BigInt(l.commitment), BigInt(l.weight))); const merkleRoot = getRoot(buildFixedTree(leafHashes));`
- Publish `poll_created` with `leaves` (and drop `serials`) in the `HCSPollMessage`.

Concrete Mirror Node holder-accounts helper to add in the route:
```ts
async function fetchNftHolders(tokenId: string): Promise<{ serial: string; account: string }[]> {
  const out: { serial: string; account: string }[] = [];
  let url: string | null = `${MIRROR_BASE}/api/v1/tokens/${tokenId}/nfts?limit=100&order=asc`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror Node ${res.status} fetching holders for ${tokenId}`);
    const data = (await res.json()) as { nfts: { serial_number: number; account_id: string }[]; links?: { next?: string } };
    for (const n of data.nfts) out.push({ serial: String(n.serial_number), account: n.account_id });
    url = data.links?.next ? `${MIRROR_BASE}${data.links.next}` : null;
  }
  return out;
}
```
Update imports: `import { buildFixedTree, getRoot, hashCommitmentLeaf, RateLimiter, safeEqual } from "@ballot/core";` and drop `hashLeaf` if now unused.

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/create-poll/route.ts
git commit -m "feat(app): snapshot holders ∩ registry into commitment leaves; reject credential polls (F1/F2)"
```

---

### Task 13: Client proof generation + registration submission

**Files:**
- Modify: `app/src/lib/zk.ts` (add `generateVoteProofV2`, remove old serial API usage)
- Modify: `app/src/lib/hedera.ts` (submit a `register` message to the registry topic)
- Modify: `app/src/lib/indexer.ts` (poll type gains `leaves`; add registry fetch)

**Interfaces:**
- Consumes: `buildCommitmentMerkleProof`, `voteNullifier`, `pollIdFromTopic` from `@ballot/core`; `IdentityProvider`.
- Produces: `generateVoteProofV2({ identitySecret, leaves, myCommitment, choiceIndex, pollId }): Promise<{ proof, publicSignals, nullifier, weight }>`; `submitRegister(client, registryTopicId, msg)`.

- [ ] **Step 1: Add `generateVoteProofV2`**

In `app/src/lib/zk.ts`:
```ts
import { buildCommitmentMerkleProof, voteNullifier } from "@ballot/core";

export async function generateVoteProofV2(input: {
  identitySecret: bigint;
  leaves: { commitment: string; weight: string }[];
  myCommitment: string;
  choiceIndex: number;
  pollId: bigint;
}): Promise<{ proof: ZKProof; publicSignals: string[]; nullifier: string; weight: string }> {
  const wasmPath = "/circuits/vote_v2_js/vote_v2.wasm";
  const zkeyPath = "/circuits/vote_v2_final.zkey";
  const { merkleRoot, leafIndex, pathElements, pathIndices } =
    buildCommitmentMerkleProof(input.leaves, input.myCommitment);
  const weight = input.leaves[leafIndex].weight;
  const nullifier = voteNullifier(input.identitySecret, input.pollId).toString();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      merkleRoot,
      nullifierHash: nullifier,
      choiceIndex: input.choiceIndex,
      pollId: input.pollId.toString(),
      weight,
      identitySecret: input.identitySecret.toString(),
      pathElements,
      pathIndices,
    },
    wasmPath,
    zkeyPath
  );
  return { proof: proof as ZKProof, publicSignals: publicSignals as string[], nullifier, weight };
}
```
(Leave or remove the old `generateVoteProof`/credential functions; remove the serial-based `generateVoteProof` since `vote.circom` is gone.)

- [ ] **Step 2: Add registry submission**

In `app/src/lib/hedera.ts`, add:
```ts
import type { HCSRegisterMessage } from "@ballot/core";

export async function submitRegister(
  client: Client,
  registryTopicId: string,
  message: HCSRegisterMessage
): Promise<void> {
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(registryTopicId))
    .setMessage(JSON.stringify(message));
  await tx.execute(client);
}
```

- [ ] **Step 3: Update the client poll type + registry fetch**

In `app/src/lib/indexer.ts`, add `leaves?: { commitment: string; weight: string }[]` to `PollWithTally`, and:
```ts
export async function fetchRegistry(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/registry`, { cache: "no-store" });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ballot/core build && cd app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/zk.ts app/src/lib/hedera.ts app/src/lib/indexer.ts
git commit -m "feat(app): v2 vote proof + registration submission + registry client (F1/F2)"
```

---

### Task 14: VoteForm rewrite + registration UI

**Files:**
- Modify: `app/src/components/VoteForm.tsx`
- Modify: `app/src/app/poll/[id]/page.tsx` (pass `leaves` + `topicId`)
- Create: `app/src/components/RegisterButton.tsx`

**Interfaces:**
- Consumes: `IdentityProvider` (`getIdentityProvider`), `generateVoteProofV2`, `submitVote`, `submitRegister`, `pollIdFromTopic`.
- Produces: a vote form that takes only a choice (no serial/secret) and uses the identity; a register action.

- [ ] **Step 1: Rewrite VoteForm**

In `app/src/components/VoteForm.tsx`, replace the serial+secret flow: props become `{ topicId, choices, merkleRoot, leaves }`. On submit:
- Obtain the connected account + signer (existing wallet integration point; for the MVP a `signMessage`/account are passed in or read from a wallet context — wire to whatever signer the app exposes; if none exists yet, gate the button with "Connect wallet").
- `const provider = getIdentityProvider(accountId, signMessage); const commitment = await provider.getCommitment();`
- If `!leaves.some(l => l.commitment === commitment)` → show "You're not in this poll's eligible set — register before the snapshot, or you weren't a holder."
- Else `const secret = await provider.getIdentitySecret(); const { proof, publicSignals, nullifier, weight } = await generateVoteProofV2({ identitySecret: secret, leaves, myCommitment: commitment, choiceIndex: selected, pollId: pollIdFromTopic(topicId) });`
- Submit vote envelope `{ type: "vote", pollTopicId: topicId, choiceIndex: selected, nullifier, weight, proof, publicSignals }` via the relayer/`submitVote`.
- Remove `getOrCreateSecret`, serial input, and the merkle-root sanity fetch (root is derived locally by `buildCommitmentMerkleProof`; still compare to `merkleRoot` and error on mismatch).

- [ ] **Step 2: Registration button**

Create `app/src/components/RegisterButton.tsx`: a button that calls `provider.signRegistration()` then `submitRegister(client, REGISTRY_TOPIC_ID, msg)` (topic id from `process.env.NEXT_PUBLIC_REGISTRY_TOPIC_ID`), showing success/failure. Include it on the poll page (or a dedicated `/register` area).

- [ ] **Step 3: Pass leaves from the poll page**

In `app/src/app/poll/[id]/page.tsx`, pass `leaves={poll.leaves ?? []}` and `topicId={topicId}` to `VoteForm`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ballot/core build && cd app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/VoteForm.tsx app/src/components/RegisterButton.tsx app/src/app/poll/[id]/page.tsx
git commit -m "feat(app): identity-based VoteForm + registration UI (F1/F2)"
```

---

## Phase 5 — Docs & cleanup

### Task 15: Docs + config + final verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `DESIGN.md`
- Modify: `app/.env.example` (add `NEXT_PUBLIC_REGISTRY_TOPIC_ID`)

- [ ] **Step 1: Update DESIGN.md flaw table**

In `DESIGN.md`, update the F1 and F2 rows to mark them implemented (link this plan), and add the registry topic to the transparency/registration description. Update the "Fix ordering" list to check off F1/F2.

- [ ] **Step 2: Update env + agent docs**

- `README.md`: document `NEXT_PUBLIC_REGISTRY_TOPIC_ID` (app) and `REGISTRY_TOPIC_ID` (indexer); note the one-time registration step and that credential-gated polls are disabled pending F7. Update the "Voting" data-flow bullet to the identity-commitment model.
- `CLAUDE.md`: add `REGISTRY_TOPIC_ID` to the indexer env list; note `vote_v2.circom` replaces `vote.circom`, and the commitment-leaf tree; update the Critical Invariants nullifier line to `Poseidon(identitySecret, pollId)` and leaf to `Poseidon(commitment, weight)`.
- `app/.env.example`: add `NEXT_PUBLIC_REGISTRY_TOPIC_ID=0.0.XXXXX`.

- [ ] **Step 3: Full verification across workspaces**

Run:
```bash
pnpm --filter @ballot/core build
pnpm --filter @ballot/core test
pnpm --filter @ballot/indexer test
cd app && npx tsc --noEmit && cd ..
```
Expected: core + indexer suites PASS; app typecheck clean. (Circuit suite requires `circom`; run `cd circuits && npm run compile && npm run setup && npm test` where available.)

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md DESIGN.md app/.env.example
git commit -m "docs: F1/F2 registration + identity-commitment model; mark flaws remediated"
```

---

## Self-review notes (coverage against the spec)

- Spec §5.1 IdentityProvider → Task 11 (app) + Task 1 (core crypto it wraps).
- Spec §5.2 registration + HCS registry → Tasks 4 (types), 6 (verify), 7 (ingest), 13/14 (submit/UI).
- Spec §5.3 poll snapshot → Task 12; leaves persisted/published in Tasks 10 + 12.
- Spec §5.4 vote_v2 circuit → Task 3.
- Spec §5.5 client proof → Tasks 2 (core helper) + 13.
- Spec §5.6 indexer verification → Tasks 8 + 9.
- Spec §5.7 weighted tally → Task 5.
- Spec §7 error handling → registration reject (6/7), ineligible voter message (14), missing vkey (existing F8), credential disabled (9/12).
- Spec §8 testing → tests present in Tasks 1–3, 5–7, 9–10.
- Spec §9 migration → Task 3 (retire vote.circom), Task 5/10 (DB columns), Task 15 (docs).
- Non-goals honored: credential circuit deferred (disabled, Tasks 9/12); wallet recovery deferred (Task 11 minimal seed); weighted polls deferred (v1 weight="1", machinery present).
