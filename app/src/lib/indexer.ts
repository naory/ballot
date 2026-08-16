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
  /**
   * The public eligible set (NFT serials). Present on the single-poll endpoint
   * so voters can build their Merkle proof client-side without revealing which
   * serial is theirs (F4). Absent on the list endpoint.
   */
  serials?: string[];
  /**
   * The public eligible set (commitment-weight pairs). Present for identity-commitment
   * polls so voters can build their Merkle proof client-side without revealing which
   * commitment is theirs (F1/F2). Absent on the list endpoint.
   */
  leaves?: { commitment: string; weight: string }[];
  tally: {
    totalVotes: number;
    counts: PollTallyEntry[];
  };
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

/** Fetch a single poll with its tally and public eligible set (`serials`). */
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

/** Fetch the registry of account → commitment mappings from the indexer */
export async function fetchRegistry(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/registry`, { cache: "no-store" });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}
