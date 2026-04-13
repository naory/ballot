/**
 * Hedera SDK client — HCS topic operations for poll creation and vote submission.
 *
 * Uses @hashgraph/sdk for topic creation and message submission.
 * Mirror Node is used for reading (see mirror.ts).
 */

import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from "@hashgraph/sdk";
import type { HCSVoteMessage, HCSPollMessage } from "@ballot/core";

/** Get a Hedera client for testnet (browser-side — no operator key) */
export function getReadOnlyClient(): Client {
  return Client.forTestnet();
}

/**
 * Get a Hedera client with operator credentials for write operations.
 * Server-side only — reads HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY env vars.
 * Throws if either env var is missing.
 */
export function getOperatorClient(): Client {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    throw new Error(
      "HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set for write operations"
    );
  }
  const client = Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  return client;
}

/** Create an HCS topic for a new poll (requires operator credentials — server action) */
export async function createPollTopic(
  client: Client,
  memo: string
): Promise<string> {
  const tx = new TopicCreateTransaction().setTopicMemo(memo);
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.topicId!.toString();
}

/** Submit a vote message to an HCS topic */
export async function submitVote(
  client: Client,
  topicId: string,
  message: HCSVoteMessage
): Promise<void> {
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(JSON.stringify(message));
  await tx.execute(client);
}

/** Submit a poll-created message to an HCS topic */
export async function publishPollMetadata(
  client: Client,
  topicId: string,
  message: HCSPollMessage
): Promise<void> {
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(JSON.stringify(message));
  await tx.execute(client);
}
