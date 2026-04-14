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
 */

import { NextRequest, NextResponse } from "next/server";
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from "@hashgraph/sdk";
import { buildFixedTree, hashLeaf, getRoot } from "@ballot/core";
import { getOperatorClient } from "@/lib/hedera";
import type { HCSPollMessage, IdosConfig } from "@ballot/core";

const MIRROR_BASE =
  process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";

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

async function fetchNftSerials(tokenId: string): Promise<string[]> {
  const serials: string[] = [];
  let url: string | null =
    `${MIRROR_BASE}/api/v1/tokens/${tokenId}/nfts?limit=100&order=asc`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Mirror Node error ${res.status} fetching holders for ${tokenId}`
      );
    }
    const data = (await res.json()) as {
      nfts: { serial_number: number }[];
      links?: { next?: string };
    };
    for (const nft of data.nfts) serials.push(String(nft.serial_number));
    url = data.links?.next ? `${MIRROR_BASE}${data.links.next}` : null;
  }

  return serials;
}

export async function POST(req: NextRequest) {
  let body: CreatePollBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, description, tokenId, choices, startsAt, endsAt, idosConfig, credentialIds } = body;

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

  // 1. Snapshot NFT holders from Mirror Node
  let serials: string[];
  try {
    serials = await fetchNftSerials(tokenId);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch NFT holders: ${String(err)}` },
      { status: 502 }
    );
  }

  if (serials.length === 0) {
    return NextResponse.json(
      { error: `No NFT holders found for token ${tokenId}` },
      { status: 400 }
    );
  }

  // 2. Build Merkle tree and compute root
  const leafHashes = serials.map((s) => hashLeaf(s));
  const layers = buildFixedTree(leafHashes);
  const merkleRoot = getRoot(layers);

  // 3. Create Hedera client
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

  // 4. Create a new HCS topic for this poll
  let topicId: string;
  try {
    const createTx = new TopicCreateTransaction().setTopicMemo(
      `ballot:${title.slice(0, 80)}`
    );
    const createResponse = await createTx.execute(client);
    const receipt = await createResponse.getReceipt(client);
    topicId = receipt.topicId!.toString();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create HCS topic: ${String(err)}` },
      { status: 502 }
    );
  }

  // 5. Publish poll metadata (including snapshot serials) to the new topic
  const message: HCSPollMessage = {
    type:          "poll_created",
    title:         title.trim(),
    description:   description?.trim() || undefined,
    choices:       choices.map((c) => c.trim()).filter(Boolean),
    tokenId,
    merkleRoot,
    startsAt,
    endsAt,
    serials,
    idosConfig:    idosConfig ?? undefined,
    credentialIds: credentialIds ?? undefined,
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
    holderCount: serials.length,
  });
}
