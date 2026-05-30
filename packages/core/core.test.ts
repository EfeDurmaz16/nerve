import { describe, expect, it } from "vitest";
import { estimateCost, estimateInputTokens, normalizeChatCompletionRequest } from "./src/index.js";

describe("TokenOps core", () => {
  it("normalizes OpenAI chat requests and preserves stable hashes", () => {
    const base = {
      model: "gpt-5.5",
      messages: [{ role: "user" as const, content: "What is TokenOps?" }],
      metadata: { request_id: "a", stable: "yes" },
    };
    const a = normalizeChatCompletionRequest(base);
    const b = normalizeChatCompletionRequest({ ...base, metadata: { request_id: "b", stable: "yes" } });
    expect(a.id).not.toBe(b.id);
    expect(a.normalized_hash).toBe(b.normalized_hash);
    expect(a.requested_model).toBe("gpt-5.5");
  });

  it("excludes runtime priority metadata from stable request hashes", () => {
    const base = {
      model: "gpt-5.5",
      messages: [{ role: "user" as const, content: "What is TokenOps?" }],
      metadata: { stable: "yes" },
    };
    const foreground = normalizeChatCompletionRequest({ ...base, metadata: { ...base.metadata, tokenops_priority: 10 } });
    const background = normalizeChatCompletionRequest({ ...base, metadata: { ...base.metadata, tokenops_priority: -10 } });

    expect(foreground.normalized_hash).toBe(background.normalized_hash);
  });

  it("estimates tokens and costs", () => {
    const req = normalizeChatCompletionRequest({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "summarize this document" }],
    });
    const tokens = estimateInputTokens(req);
    const cost = estimateCost("gpt-5-mini", tokens, 100);
    expect(tokens).toBeGreaterThan(0);
    expect(cost.totalCostUsd).toBeGreaterThanOrEqual(0);
  });
});
