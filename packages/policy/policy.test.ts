import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { detectAgentLoop, evaluateBudgetPolicy } from "./src/index.js";
import type { RequestTrace } from "@tokenops/core";

describe("TokenOps policy", () => {
  it("blocks over max request cost", () => {
    const request = normalizeChatCompletionRequest({ model: "gpt-5.5", messages: [{ role: "user", content: "x" }] });
    const decision = evaluateBudgetPolicy({ request, estimate: { inputTokens: 1, outputTokens: 1, inputCostUsd: 0, outputCostUsd: 1, totalCostUsd: 1 } });
    expect(decision.action).toBe("block");
  });

  it("detects repeated prompt loop", () => {
    const traces = Array.from({ length: 6 }, (_, i) => ({ id: String(i), timestamp: new Date().toISOString(), workloadType: "agent_planning", requestedModel: "m", selectedModel: "m", selectedProvider: "mock", inputTokensEstimated: 1, cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 }, routing: { selectedProvider: "mock", selectedModel: "m", downgraded: false, escalated: false, reason: "x" }, policy: { allowed: true, reason: "x" }, cost: { estimatedBaselineCost: 0, estimatedOptimizedCost: 0, estimatedSavings: 0 }, normalizedHash: "same", finalResponseSource: "model" })) as RequestTrace[];
    expect(detectAgentLoop(traces).action).toBe("block");
  });
});
