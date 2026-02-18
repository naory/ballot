/** A voting poll anchored to an HCS topic */
export interface Poll {
  /** HCS topic ID used for vote submission */
  topicId: string;
  /** Human-readable title */
  title: string;
  /** Optional description / context */
  description?: string;
  /** Ordered list of choices voters can pick from */
  choices: string[];
  /** HTS NFT token ID that gates voting eligibility */
  tokenId: string;
  /** Merkle root of eligible NFT serial numbers at snapshot time */
  merkleRoot: string;
  /** ISO-8601 timestamp when voting opens */
  startsAt: string;
  /** ISO-8601 timestamp when voting closes */
  endsAt: string;
  /** Account ID of the poll creator */
  creator: string;
}

/** A single vote submitted to HCS */
export interface Vote {
  /** HCS topic ID the vote belongs to */
  topicId: string;
  /** Index of the chosen option in Poll.choices */
  choiceIndex: number;
  /** Nullifier to prevent double voting (hash of serial + secret) */
  nullifier: string;
  /** ZK proof blob (JSON-serialized snarkjs proof) */
  proof: string;
  /** Public signals for proof verification */
  publicSignals: string[];
}

/** Shape of snarkjs proof object */
export interface ZKProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

/** Tally result for a poll */
export interface Tally {
  topicId: string;
  /** Map from choice index to vote count */
  counts: Record<number, number>;
  /** Total verified votes */
  totalVotes: number;
  /** Set of nullifiers already counted (prevents double-count) */
  nullifiers: Set<string>;
}

/** HCS message envelope for vote submission */
export interface HCSVoteMessage {
  type: "vote";
  pollTopicId: string;
  choiceIndex: number;
  nullifier: string;
  proof: ZKProof;
  publicSignals: string[];
}

/** HCS message envelope for poll creation */
export interface HCSPollMessage {
  type: "poll_created";
  title: string;
  description?: string;
  choices: string[];
  tokenId: string;
  merkleRoot: string;
  startsAt: string;
  endsAt: string;
}
