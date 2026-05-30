import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { planCompute } from "./src/index.js";

describe("TokenOps AIS", () => {
  it("serves exact cache in foreground", () => {
    const request = normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "x" }] });
    const plan = planCompute({ request, exactHit: true, semanticHit: false, prefixCacheEligibleTokens: 0, riskLevel: "low", expectedCostUsd: 0.1, policy: { action: "allow", allowed: true, reason: "ok" }, route: { selectedProvider: "mock", selectedModel: "mock", originalRequestedModel: "mock", downgraded: false, escalated: false, reason: "ok" } });
    expect(plan.foregroundAction).toBe("serve_exact_cache");
  });
});
