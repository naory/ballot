/**
 * Hedera Mirror Node REST API helpers.
 * Used to fetch NFT holders, HCS messages, and topic info.
 */

const MIRROR_BASE =
  process.env.NEXT_PUBLIC_MIRROR_NODE_URL ||
  "https://testnet.mirrornode.hedera.com";

interface MirrorNft {
  account_id: string;
  serial_number: number;
  token_id: string;
}

interface MirrorTopicMessage {
  consensus_timestamp: string;
  message: string; // base64-encoded
  sequence_number: number;
}

/** Fetch all NFT holders (serial numbers) for a given HTS token */
export async function fetchNftHolders(
  tokenId: string
): Promise<MirrorNft[]> {
  const nfts: MirrorNft[] = [];
  let url: string | null = `${MIRROR_BASE}/api/v1/tokens/${tokenId}/nfts?limit=100`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
    const data = (await res.json()) as {
      nfts: MirrorNft[];
      links?: { next?: string };
    };
    nfts.push(...data.nfts);
    url = data.links?.next ? `${MIRROR_BASE}${data.links.next}` : null;
  }

  return nfts;
}

/** Fetch HCS messages for a topic (paginated) */
export async function fetchTopicMessages(
  topicId: string,
  afterTimestamp?: string
): Promise<MirrorTopicMessage[]> {
  const messages: MirrorTopicMessage[] = [];
  let url = `${MIRROR_BASE}/api/v1/topics/${topicId}/messages?limit=100`;
  if (afterTimestamp) url += `&timestamp=gt:${afterTimestamp}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
  const data = await res.json();
  messages.push(...data.messages);

  return messages;
}

/** Decode a base64-encoded HCS message */
export function decodeMessage<T>(base64: string): T {
  const json = Buffer.from(base64, "base64").toString("utf-8");
  return JSON.parse(json) as T;
}
