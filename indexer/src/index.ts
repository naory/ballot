/**
 * Indexer entry point.
 * Starts the HCS subscriber and GraphQL API.
 */

import { HCSSubscriber } from "./subscriber.js";
import { verifyVoteProof } from "./verifier.js";
import { insertPoll, insertVote, getDb } from "./db.js";
import { startApi } from "./api.js";
import type { HCSVoteMessage, HCSPollMessage } from "@ballot/core";

const PORT = Number(process.env.PORT) || 4000;

// Initialize DB
getDb();

// Message handler — processes incoming HCS messages
const subscriber = new HCSSubscriber(
  async (topicId: string, message: unknown, timestamp: string) => {
    const msg = message as { type: string };

    if (msg.type === "poll_created") {
      const poll = message as HCSPollMessage;
      console.log(`[indexer] New poll: ${poll.title} (${topicId})`);
      insertPoll({
        topicId,
        title: poll.title,
        description: poll.description,
        choices: poll.choices,
        tokenId: poll.tokenId,
        merkleRoot: poll.merkleRoot,
        startsAt: poll.startsAt,
        endsAt: poll.endsAt,
      });
    }

    if (msg.type === "vote") {
      const vote = message as HCSVoteMessage;
      console.log(`[indexer] Vote on ${topicId}, choice=${vote.choiceIndex}`);

      // Verify ZK proof before counting
      const valid = await verifyVoteProof(vote.proof, vote.publicSignals);
      if (!valid) {
        console.warn(`[indexer] Invalid proof for nullifier ${vote.nullifier}`);
        return;
      }

      const inserted = insertVote({
        topicId: vote.pollTopicId,
        choiceIndex: vote.choiceIndex,
        nullifier: vote.nullifier,
        proof: JSON.stringify(vote.proof),
        publicSignals: vote.publicSignals,
        consensusTs: timestamp,
      });

      if (!inserted) {
        console.warn(`[indexer] Duplicate nullifier ${vote.nullifier}`);
      }
    }
  }
);

// TODO: On startup, load tracked topics from DB and subscribe to each
// subscriber.subscribe("0.0.XXXXXX");
// subscriber.start();

// Start GraphQL API
startApi(PORT);

console.log(`[indexer] Ballot indexer started on port ${PORT}`);
