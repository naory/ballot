/**
 * Combined REST + GraphQL API server.
 *
 * REST  — /api/polls, /api/polls/:topicId, /api/polls/:topicId/merkle-proof
 * GraphQL — /graphql (polls, tally queries)
 */

import { createSchema, createYoga } from "graphql-yoga";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAllPolls, getPoll } from "./db.js";
import { computeTally } from "./tally.js";
import { buildFixedTree, getProof, hashLeaf } from "@ballot/core";

// ---------------------------------------------------------------------------
// Mirror Node helper (server-side)
// ---------------------------------------------------------------------------

const MIRROR_BASE =
  process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";

async function fetchNftSerials(tokenId: string): Promise<string[]> {
  const serials: string[] = [];
  let url: string | null =
    `${MIRROR_BASE}/api/v1/tokens/${tokenId}/nfts?limit=100&order=asc`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror Node ${res.status} fetching ${url}`);
    const data = (await res.json()) as {
      nfts: { serial_number: number }[];
      links?: { next?: string };
    };
    for (const nft of data.nfts) serials.push(String(nft.serial_number));
    url = data.links?.next ? `${MIRROR_BASE}${data.links.next}` : null;
  }

  return serials;
}

// ---------------------------------------------------------------------------
// Row → API shape
// ---------------------------------------------------------------------------

function formatPoll(row: Record<string, unknown>) {
  return {
    topicId:     row.topic_id,
    title:       row.title,
    description: row.description ?? null,
    choices:     JSON.parse(row.choices as string) as string[],
    tokenId:     row.token_id,
    merkleRoot:  row.merkle_root,
    startsAt:    row.starts_at,
    endsAt:      row.ends_at,
    creator:     row.creator ?? null,
  };
}

function pollWithTally(row: Record<string, unknown>) {
  const poll = formatPoll(row);
  const tally = computeTally(poll.topicId as string);
  return {
    ...poll,
    tally: {
      totalVotes: tally.totalVotes,
      counts: Object.entries(tally.counts).map(([idx, count]) => ({
        choiceIndex: Number(idx),
        count,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// REST handler
// ---------------------------------------------------------------------------

async function handleRest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const json = (status: number, body: unknown) => {
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };

  // GET /api/polls
  if (req.method === "GET" && path === "/api/polls") {
    const rows = getAllPolls() as Record<string, unknown>[];
    json(200, rows.map(pollWithTally));
    return;
  }

  // GET /api/polls/:topicId
  // GET /api/polls/:topicId/merkle-proof?serial=N
  const pollSegment = path.match(/^\/api\/polls\/([^/]+)(\/merkle-proof)?$/);
  if (req.method === "GET" && pollSegment) {
    const topicId = decodeURIComponent(pollSegment[1]);
    const wantProof = Boolean(pollSegment[2]);

    const row = getPoll(topicId) as Record<string, unknown> | undefined;
    if (!row) {
      json(404, { error: "Poll not found" });
      return;
    }

    if (!wantProof) {
      json(200, pollWithTally(row));
      return;
    }

    // --- Merkle proof endpoint ---
    const serial = url.searchParams.get("serial");
    if (!serial) {
      json(400, { error: "serial query param required" });
      return;
    }

    try {
      // Prefer the snapshot stored at poll creation time; fall back to live
      // Mirror Node state only for polls created before Phase 3.
      const storedSerials = row.serials
        ? (JSON.parse(row.serials as string) as string[])
        : null;
      const serials = storedSerials ?? await fetchNftSerials(row.token_id as string);

      const idx = serials.indexOf(serial);
      if (idx === -1) {
        json(403, { error: `Serial ${serial} is not in the eligible set` });
        return;
      }

      const leafHashes = serials.map((s) => hashLeaf(s));
      const layers = buildFixedTree(leafHashes);
      const rawProof = getProof(layers, idx);

      // Convert to circuit inputs:
      //   pathElements — sibling hashes as decimal strings
      //   pathIndices  — 0 = current is left child, 1 = current is right child
      const pathElements = rawProof.map((p) => p.sibling);
      const pathIndices = rawProof.map((p) => (p.direction === "left" ? 1 : 0));

      json(200, {
        serial,
        merkleRoot: row.merkle_root,
        pathElements,
        pathIndices,
      });
    } catch (err) {
      console.error("[api] merkle-proof error:", err);
      json(500, { error: String(err) });
    }
    return;
  }

  json(404, { error: "Not found" });
}

// ---------------------------------------------------------------------------
// GraphQL schema (unchanged)
// ---------------------------------------------------------------------------

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Poll {
      topicId:     String!
      title:       String!
      description: String
      choices:     [String!]!
      tokenId:     String!
      merkleRoot:  String!
      startsAt:    String!
      endsAt:      String!
      creator:     String
    }

    type TallyEntry {
      choiceIndex: Int!
      count:       Int!
    }

    type Tally {
      topicId:    String!
      totalVotes: Int!
      counts:     [TallyEntry!]!
    }

    type Query {
      polls:               [Poll!]!
      poll(topicId: String!): Poll
      tally(topicId: String!): Tally
    }
  `,
  resolvers: {
    Query: {
      polls: () => (getAllPolls() as Record<string, unknown>[]).map(formatPoll),
      poll: (_, { topicId }: { topicId: string }) => {
        const row = getPoll(topicId) as Record<string, unknown> | undefined;
        return row ? formatPoll(row) : null;
      },
      tally: (_, { topicId }: { topicId: string }) => {
        const t = computeTally(topicId);
        return {
          topicId: t.topicId,
          totalVotes: t.totalVotes,
          counts: Object.entries(t.counts).map(([idx, count]) => ({
            choiceIndex: Number(idx),
            count,
          })),
        };
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Combined server
// ---------------------------------------------------------------------------

export function startApi(port = 4000): void {
  const yoga = createYoga({ schema });

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/")) {
      handleRest(req, res).catch((err) => {
        console.error("[api] unhandled error:", err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    } else {
      // graphql-yoga handles /graphql
      yoga(req, res);
    }
  });

  server.listen(port, () => {
    console.log(`[api] REST  → http://localhost:${port}/api/polls`);
    console.log(`[api] GraphQL → http://localhost:${port}/graphql`);
  });
}
