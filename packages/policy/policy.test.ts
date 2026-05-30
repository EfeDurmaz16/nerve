import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { detectAgentLoop, evaluateBudgetPolicy, simulateBudgetPolicy } from "./src/index.js";
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

  it("simulates budget policy impact across stored traces", () => {
    const result = simulateBudgetPolicy([
      trace({ id: "first", baseline: 0.01, optimized: 0.004 }),
      trace({ id: "too_expensive", baseline: 0.03, optimized: 0.006 }),
      trace({ id: "after_budget", baseline: 0.01, optimized: 0.004 }),
    ], {
      policy: {
        policy_id: "simulation",
        daily_budget_usd: 0.01,
        max_request_cost_usd: 0.02,
        max_model: "gpt-5.5",
        allow_expensive_models: true,
        block_on_budget_exceeded: true,
        warn_threshold: 0.8,
      },
    });

    expect(result.totalTraces).toBe(3);
    expect(result.allowed).toBe(1);
    expect(result.blocked).toBe(2);
    expect(result.estimatedAvoidedCostUsd).toBeCloseTo(0.04);
    expect(result.decisions.find((decision) => decision.traceId === "too_expensive")?.reason).toContain("max_request_cost_usd");
    expect(result.decisions.find((decision) => decision.traceId === "after_budget")?.reason).toContain("daily budget exhausted");
  });

  it("marks high-risk policy simulation decisions as requiring a verifier", () => {
    const result = simulateBudgetPolicy([
      trace({ id: "risky", workloadType: "high_risk_action", baseline: 0.01, optimized: 0.01 }),
    ]);

    expect(result.requireVerifier).toBe(1);
    expect(result.decisions[0]?.action).toBe("require_verifier");
  });
});

function trace(input: {
  id: string;
  baseline: number;
  optimized: number;
  workloadType?: RequestTrace["workloadType"];
}): RequestTrace {
  return {
    id: input.id,
    timestamp: "2026-05-30T00:00:00.000Z",
    workloadType: input.workloadType ?? "chat",
    userId: "u1",
    requestedModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    selectedProvider: "mock",
    inputTokensEstimated: 100,
    outputTokensEstimated: 50,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: "mock", selectedModel: "gpt-5.5", originalRequestedModel: "gpt-5.5", downgraded: false, escalated: false, reason: "fixture" },
    policy: { allowed: true, reason: "fixture" },
    cost: {
      estimatedBaselineCost: input.baseline,
      estimatedOptimizedCost: input.optimized,
      estimatedSavings: Math.max(0, input.baseline - input.optimized),
    },
    normalizedHash: input.id,
    finalResponseSource: "model",
  };
}
