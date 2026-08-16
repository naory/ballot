/**
 * POST /api/create-poll
 *
 * Server-side poll creation. Runs with operator credentials from env vars
 * so the browser doesn't need a wallet for this phase.
 *
 * Required env vars:
 *   HEDERA_OPERATOR_ID  — Hedera account ID  (e.g. 0.0.12345)
 *   HEDERA_OPERATOR_KEY — Private key (DER hex or PEM)
 *
 * Optional:
 *   MIRROR_NODE_URL — defaults to testnet mirror node
 *   INDEXER_URL     — defaults to http://localhost:4000
 */

import { NextRequest, NextResponse } from "next/server";
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from "@hashgraph/sdk";
import { buildFixedTree, hashCommitmentLeaf, getRoot, RateLimiter, safeEqual } from "@ballot/core";
import { getOperatorClient } from "@/lib/hedera";
import type { HCSPollMessage, IdosConfig, PollLeaf } from "@ballot/core";

const MIRROR_BASE =
  process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";

const INDEXER_URL = process.env.INDEXER_URL || "http://localhost:4000";

// F5 — gate poll creation so anonymous callers can't spend the operator's HBAR.
// When CREATE_POLL_API_KEY is set, callers must send `Authorization: Bearer <key>`.
const CREATE_POLL_API_KEY = process.env.CREATE_POLL_API_KEY;
// Per-client throttle (fixed window). State is per server instance.
const createPollLimiter = new RateLimiter(5, 10 * 60 * 1000); // 5 per 10 minutes

/**
 * Best-effort client identifier from proxy headers.
 *
 * `x-forwarded-for` is client-controlled unless a trusted reverse proxy
 * overwrites it, so this rate limiter is defense-in-depth only — the API key is
 * the primary guard against spending the operator's HBAR. Deploy behind a proxy
 * that sets a trustworthy forwarded-for for the throttle to be per-client.
 */
function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

interface CreatePollBody {
  title: string;
  description?: string;
  tokenId: string;
  choices: string[];
  startsAt: string;
  endsAt: string;
  /** Optional idOS credential requirement. When present, credentialIds must also be provided. */
  idosConfig?: IdosConfig;
  /** Credential IDs snapshot (required when idosConfig is set) */
  credentialIds?: string[];
}

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

export async function POST(req: NextRequest) {
  // F5 — throttle per client, then require the API key when configured. Both run
  // before any Hedera/Mirror Node work so abuse is cheap to reject.
  if (!createPollLimiter.check(clientKey(req))) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 }
    );
  }

  if (CREATE_POLL_API_KEY) {
    const auth = req.headers.get("authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!safeEqual(provided, CREATE_POLL_API_KEY)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[create-poll] CREATE_POLL_API_KEY is not set — the endpoint is UNAUTHENTICATED " +
        "and anyone can spend the operator's HBAR (F5)."
    );
  }

  let body: CreatePollBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, description, tokenId, choices, startsAt, endsAt, idosConfig } = body;

  if (!title?.trim())
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!tokenId?.trim())
    return NextResponse.json({ error: "tokenId is required" }, { status: 400 });
  if (!Array.isArray(choices) || choices.length < 2)
    return NextResponse.json(
      { error: "at least 2 choices are required" },
      { status: 400 }
    );
  if (!startsAt || !endsAt)
    return NextResponse.json(
      { error: "startsAt and endsAt are required" },
      { status: 400 }
    );

  // Reject credential-gated polls until F7 is implemented.
  if (idosConfig) {
    return NextResponse.json(
      { error: "Credential-gated polls are temporarily disabled (pending F7)." },
      { status: 400 }
    );
  }

  // 1. Snapshot NFT holders (account + serial) from Mirror Node
  let holders: { serial: string; account: string }[];
  try {
    holders = await fetchNftHolders(tokenId);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch NFT holders: ${String(err)}` },
      { status: 502 }
    );
  }

  if (holders.length === 0) {
    return NextResponse.json(
      { error: `No NFT holders found for token ${tokenId}` },
      { status: 400 }
    );
  }

  // 2. Fetch identity registry from indexer
  let registry: Record<string, string>;
  try {
    const regRes = await fetch(`${INDEXER_URL}/api/registry`);
    if (!regRes.ok) throw new Error(`Indexer responded with ${regRes.status}`);
    registry = (await regRes.json()) as Record<string, string>;
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch identity registry: ${String(err)}` },
      { status: 502 }
    );
  }

  // 3. Build eligible leaf set: holders present in registry, deduped by commitment
  const seen = new Set<string>();
  const leaves: PollLeaf[] = [];
  for (const { account } of holders) {
    const commitment = registry[account];
    if (commitment === undefined) continue;
    if (seen.has(commitment)) continue;
    seen.add(commitment);
    leaves.push({ commitment, weight: "1" });
  }

  if (leaves.length === 0) {
    return NextResponse.json(
      { error: "No registered holders for this token. Voters must register before the snapshot." },
      { status: 400 }
    );
  }

  // 4. Build Merkle tree over commitment leaves and compute root
  const leafHashes = leaves.map((l) => hashCommitmentLeaf(BigInt(l.commitment), BigInt(l.weight)));
  const merkleRoot = getRoot(buildFixedTree(leafHashes));

  // 5. Create Hedera client
  let client;
  try {
    client = getOperatorClient();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error:
          "Hedera operator credentials not configured on server. " +
          "Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY env vars. " +
          `(${detail})`,
      },
      { status: 503 }
    );
  }

  // 6. Create a new HCS topic for this poll
  let topicId: string;
  try {
    // Lock the topic with a submit key so only this operator can publish to it
    // (F6). Without a submit key, anyone who learns the topic ID could inject a
    // forged poll_created. Consequently, vote messages must be submitted by the
    // operator/relayer (see DESIGN.md Decision 3), not directly by voters.
    const createTx = new TopicCreateTransaction()
      .setTopicMemo(`ballot:${title.slice(0, 80)}`)
      .setSubmitKey(client.operatorPublicKey!);
    const createResponse = await createTx.execute(client);
    const receipt = await createResponse.getReceipt(client);
    topicId = receipt.topicId!.toString();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create HCS topic: ${String(err)}` },
      { status: 502 }
    );
  }

  // 7. Publish poll metadata (including commitment leaves) to the new topic
  const message: HCSPollMessage = {
    type:        "poll_created",
    title:       title.trim(),
    description: description?.trim() || undefined,
    choices:     choices.map((c) => c.trim()).filter(Boolean),
    tokenId,
    merkleRoot,
    startsAt,
    endsAt,
    leaves,
  };

  try {
    const submitTx = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(JSON.stringify(message));
    await submitTx.execute(client);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to publish poll metadata to HCS: ${String(err)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    topicId,
    merkleRoot,
    holderCount: leaves.length,
  });
}
