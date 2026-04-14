/**
 * Indexer entry point.
 * On startup: loads all known polls from DB and subscribes to their HCS topics.
 * Incoming messages are ZK-verified before being counted.
 */

import { HCSSubscriber } from "./subscriber.js";
import { handleMessage } from "./handler.js";
import { getAllPolls, getDb } from "./db.js";
import { startApi } from "./api.js";

const PORT = Number(process.env.PORT) || 4000;

// Ensure DB + schema exist
getDb();

// Message handler — processes incoming HCS messages for any tracked topic
const subscriber = new HCSSubscriber(
  (topicId: string, message: unknown, timestamp: string) =>
    handleMessage(topicId, message, timestamp, (newTopicId) => {
      // Subscribe to the new topic so votes arriving after poll_created are processed
      subscriber.subscribe(newTopicId);
    })
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
