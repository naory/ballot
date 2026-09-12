import { describe, it, expect } from "vitest";
import type { HCSRegisterMessage, HCSPollMessage, HCSVoteMessage, PollLeaf } from "./index.js";

describe("new envelope types", () => {
  it("HCSRegisterMessage shape", () => {
    const m: HCSRegisterMessage = {
      type: "register", accountId: "0.0.9", commitment: "42", signature: "ab", ts: "1",
    };
    expect(m.type).toBe("register");
  });
  it("poll leaves + vote weight compile", () => {
    const leaf: PollLeaf = { commitment: "1", weight: "1" };
    const poll: HCSPollMessage = {
      type: "poll_created", title: "t", choices: ["a", "b"], tokenId: "0.0.1",
      merkleRoot: "0", startsAt: "s", endsAt: "e", leaves: [leaf],
    };
    const vote: HCSVoteMessage = {
      type: "vote", pollTopicId: "0.0.2", choiceIndex: 0, nullifier: "n",
      weight: "1", proof: {} as any, publicSignals: [],
    };
    expect(poll.leaves?.[0].weight).toBe("1");
    expect(vote.weight).toBe("1");
  });
});
