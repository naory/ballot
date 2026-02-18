/**
 * HCS topic listener via Mirror Node REST API.
 * Polls for new messages on tracked topics and processes them.
 */

const MIRROR_BASE =
  process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";
const POLL_INTERVAL_MS = 5_000;

interface MirrorMessage {
  consensus_timestamp: string;
  message: string; // base64
  sequence_number: number;
}

type MessageHandler = (topicId: string, message: unknown, timestamp: string) => void;

export class HCSSubscriber {
  private topics: Map<string, string> = new Map(); // topicId -> lastTimestamp
  private handler: MessageHandler;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  /** Subscribe to a topic, optionally starting from a timestamp */
  subscribe(topicId: string, afterTimestamp?: string): void {
    this.topics.set(topicId, afterTimestamp ?? "0.0");
    console.log(`[subscriber] Watching topic ${topicId}`);
  }

  /** Start polling for new messages */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    console.log(`[subscriber] Polling every ${POLL_INTERVAL_MS}ms`);
  }

  /** Stop polling */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    for (const [topicId, lastTs] of this.topics) {
      try {
        const url = `${MIRROR_BASE}/api/v1/topics/${topicId}/messages?limit=25&timestamp=gt:${lastTs}&order=asc`;
        const res = await fetch(url);
        if (!res.ok) continue;

        const data = await res.json();
        const messages: MirrorMessage[] = data.messages ?? [];

        for (const msg of messages) {
          const decoded = JSON.parse(
            Buffer.from(msg.message, "base64").toString("utf-8")
          );
          this.handler(topicId, decoded, msg.consensus_timestamp);
          this.topics.set(topicId, msg.consensus_timestamp);
        }
      } catch (err) {
        console.error(`[subscriber] Error polling ${topicId}:`, err);
      }
    }
  }
}
