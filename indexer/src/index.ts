/**
 * Indexer entry point.
 * On startup: loads all known polls from DB and subscribes to their HCS topics.
 * Incoming messages are ZK-verified before being counted.
 */

import { HCSSubscriber } from "./subscriber.js";
import { verifyVoteProof } from "./verifier.js";
import { insertPoll, insertVote, getAllPolls, getDb } from "./db.js";
import { startApi } from "./api.js";
import type { HCSVoteMessage, HCSPollMessage } from "@ballot/core";

const PORT = Number(process.env.PORT) || 4000;

// Ensure DB + schema exist
getDb();

// Message handler — processes incoming HCS messages for any tracked topic
const subscriber = new HCSSubscriber(
  async (topicId: string, message: unknown, timestamp: string) => {
    const msg = message as { type: string };

    if (msg.type === "poll_created") {
      const poll = message as HCSPollMessage;
      console.log(`[indexer] New poll: "${poll.title}" on topic ${topicId}`);
      insertPoll({
        topicId,
        title:       poll.title,
        description: poll.description,
        choices:     poll.choices,
        tokenId:     poll.tokenId,
        merkleRoot:  poll.merkleRoot,
        startsAt:    poll.startsAt,
        endsAt:      poll.endsAt,
      });
      // Subscribe to the new topic so votes arriving after this poll_created
      // message are processed. (Existing polls are subscribed on startup.)
      subscriber.subscribe(topicId);
    }

    if (msg.type === "vote") {
      const vote = message as HCSVoteMessage;
      console.log(`[indexer] Vote on ${topicId}, choice=${vote.choiceIndex}, nullifier=${vote.nullifier}`);

      const valid = await verifyVoteProof(vote.proof, vote.publicSignals);
      if (!valid) {
        console.warn(`[indexer] Rejected: invalid ZK proof for nullifier ${vote.nullifier}`);
        return;
      }

      const inserted = insertVote({
        topicId:      vote.pollTopicId,
        choiceIndex:  vote.choiceIndex,
        nullifier:    vote.nullifier,
        proof:        JSON.stringify(vote.proof),
        publicSignals: vote.publicSignals,
        consensusTs:  timestamp,
      });

      if (!inserted) {
        console.warn(`[indexer] Rejected: duplicate nullifier ${vote.nullifier}`);
      } else {
        console.log(`[indexer] Vote counted for topic ${vote.pollTopicId}`);
      }
    }
  }
);

// Load all known polls from DB and subscribe to their HCS topics
const existingPolls = getAllPolls() as { topic_id: string }[];
for (const poll of existingPolls) {
  subscriber.subscribe(poll.topic_id);
  console.log(`[indexer] Resuming subscription for topic ${poll.topic_id}`);
}

subscriber.start();
console.log(`[indexer] HCS subscriber started (${existingPolls.length} existing polls)`);

// Start REST + GraphQL API
startApi(PORT);
console.log(`[indexer] Ballot indexer running on port ${PORT}`);
