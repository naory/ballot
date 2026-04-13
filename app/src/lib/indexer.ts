/**
 * Typed client for the Ballot indexer REST API.
 *
 * Server components use INDEXER_URL (private).
 * Client components use NEXT_PUBLIC_INDEXER_URL (public).
 * Both fall back to http://localhost:4000.
 */

const INDEXER_URL =
  (typeof window === "undefined"
    ? process.env.INDEXER_URL
    : process.env.NEXT_PUBLIC_INDEXER_URL) ?? "http://localhost:4000";

export interface PollTallyEntry {
  choiceIndex: number;
  count: number;
}

export interface PollWithTally {
  topicId: string;
  title: string;
  description: string | null;
  choices: string[];
  tokenId: string;
  merkleRoot: string;
  startsAt: string;
  endsAt: string;
  creator: string | null;
  tally: {
    totalVotes: number;
    counts: PollTallyEntry[];
  };
}

export interface MerkleProofResult {
  serial: string;
  merkleRoot: string;
  pathElements: string[];
  pathIndices: number[];
}

/** Fetch all polls with their current tallies */
export async function fetchPolls(): Promise<PollWithTally[]> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/polls`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/** Fetch a single poll with its tally */
export async function fetchPoll(topicId: string): Promise<PollWithTally | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/polls/${encodeURIComponent(topicId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch the Merkle proof for a voter's NFT serial in a given poll.
 * Throws if the serial is not eligible or the indexer is unreachable.
 */
export async function fetchMerkleProof(
  topicId: string,
  serial: string
): Promise<MerkleProofResult> {
  const url = `${INDEXER_URL}/api/polls/${encodeURIComponent(topicId)}/merkle-proof?serial=${encodeURIComponent(serial)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error: string }).error ?? res.statusText);
  }
  return res.json();
}
