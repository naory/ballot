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
  /**
   * Optional idOS credential requirement.
   * When present, voters must additionally prove they hold a valid credential
   * from the specified issuer using vote_with_credential.circom.
   */
  idosConfig?: IdosConfig;
}

/**
 * Configuration for idOS credential-gated polls.
 * The poll creator snapshots all valid credential IDs from the issuer and
 * builds a second Merkle tree — mirroring how NFT serials are handled.
 */
export interface IdosConfig {
  /** idOS issuer DID or account address that issued the required credential */
  issuerId: string;
  /** W3C VC credential type string (e.g. "KYCCredential", "HumanCredential") */
  credentialType: string;
  /** Merkle root of valid credential IDs from the issuer at snapshot time */
  credentialMerkleRoot: string;
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
  /** NFT nullifier = Poseidon(serial, secret) */
  nullifier: string;
  proof: ZKProof;
  publicSignals: string[];
  /**
   * Credential nullifier = Poseidon(credentialId, credentialSecret).
   * Present only when the poll has idosConfig.
   * Stored separately so the indexer can deduplicate without parsing publicSignals.
   * Also equals publicSignals[4] in the vote_with_credential circuit.
   */
  credentialNullifier?: string;
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
  /**
   * NFT serial numbers eligible to vote (snapshot at creation time).
   * Stored alongside the poll so the proof endpoint can serve consistent
   * Merkle paths even after NFTs are transferred.
   * Optional for backwards compatibility with pre-Phase-3 messages.
   */
  serials?: string[];
  /** Optional idOS credential requirement — see IdosConfig */
  idosConfig?: IdosConfig;
  /**
   * Credential IDs from the idOS issuer at snapshot time.
   * Stored so the credential Merkle proof endpoint can serve consistent
   * paths even if credentials are added/revoked after poll creation.
   */
  credentialIds?: string[];
}
