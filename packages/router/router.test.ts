import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { applyLearnedRouting, applySloRouting, learnRoutingPolicy, learnSloRoutingPolicy, providerFor, routeModel } from "./src/index.js";
import type { ProviderHealthReport } from "@tokenops/ledger";
import type { RequestTrace } from "@tokenops/core";

describe("TokenOps router", () => {
  it("downgrades safe docs qa", () => {
    const request = normalizeChatCompletionRequest({ model: "gpt-5.5", messages: [{ role: "user", content: "docs quickstart" }] });
    const route = routeModel({ request, workloadType: "docs_qa", complexity: "low", riskLevel: "low" });
    expect(route.downgraded).toBe(true);
    expect(route.selectedModel).toBe("gpt-5-mini");
  });

  it("escalates high-risk mini request", () => {
    const request = normalizeChatCompletionRequest({ model: "gpt-5-mini", messages: [{ role: "user", content: "wire payment" }] });
    const route = routeModel({ request, workloadType: "high_risk_action", complexity: "medium", riskLevel: "high" });
    expect(route.escalated).toBe(true);
  });

  it("learns routing policy from successful traces", () => {
    const traces = [trace("tr_1", 0.01), trace("tr_2", 0.02), trace("tr_3", 0.5, "gpt-5.5")];
    const policy = learnRoutingPolicy(traces, { minSamples: 2 });
    expect(policy.rules[0]?.selectedModel).toBe("gpt-5-mini");
    const base = {
      selectedProvider: "groq",
      selectedModel: "gpt-5.5",
      originalRequestedModel: "gpt-5.5",
      downgraded: false,
      escalated: false,
      reason: "base",
    };
    expect(applyLearnedRouting(base, { workloadType: "docs_qa", riskLevel: "low" }, policy).selectedModel).toBe("gpt-5-mini");
  });

  it("requires verifier pass-rate before learning a cheap route", () => {
    const traces = [
      trace("cheap_pass", 0.001, "gpt-5-mini", { verifierPassed: true }),
      trace("cheap_fail", 0.001, "gpt-5-mini", { verifierPassed: false }),
      trace("strong_pass_1", 0.01, "gpt-5.5", { verifierPassed: true }),
      trace("strong_pass_2", 0.01, "gpt-5.5", { verifierPassed: true }),
    ];
    const policy = learnRoutingPolicy(traces, { minSamples: 2, minVerifierPassRate: 0.9 });
    expect(policy.rules[0]?.selectedModel).toBe("gpt-5.5");
    expect(policy.rules[0]?.verifierPassRate).toBe(1);
  });

  it("does not apply a learned route when provider health is below threshold", () => {
    const policy = learnRoutingPolicy([trace("tr_1", 0.001), trace("tr_2", 0.001)], { minSamples: 2 });
    const base = {
      selectedProvider: "mock",
      selectedModel: "gpt-5.5",
      originalRequestedModel: "gpt-5.5",
      downgraded: false,
      escalated: false,
      reason: "base",
    };
    const health: ProviderHealthReport = {
      generatedAt: new Date().toISOString(),
      providers: {
        groq: {
          provider: "groq",
          requests: 10,
          blockedRate: 0,
          verifierPassRate: 0.4,
          averageOptimizedCostUsd: 0.001,
          p95LatencyMs: 100,
          cacheHitRate: 0,
          healthScore: 0.4,
        },
      },
    };
    const routed = applyLearnedRouting(base, { workloadType: "docs_qa", riskLevel: "low" }, policy, { providerHealth: health, minProviderHealthScore: 0.8 });
    expect(routed.selectedModel).toBe("gpt-5.5");
    expect(routed.reason).toContain("provider health below threshold");
  });

  it("builds provider fallback chains from comma-separated names", () => {
    const provider = providerFor("mock,ollama");
    expect(provider.name).toBe("fallback");
  });

  it("reroutes away from providers that violate local SLO windows", () => {
    const policy = learnSloRoutingPolicy([
      trace("groq_error", 0.001, "gpt-5-mini", { verifierUsed: true, verifierPassed: true }, { provider: "groq", source: "provider_error", latency: 20_000 }),
      trace("groq_slow", 0.001, "gpt-5-mini", { verifierUsed: true, verifierPassed: true }, { provider: "groq", latency: 15_000 }),
      trace("mock_ok_1", 0, "gpt-5-mini", { verifierUsed: true, verifierPassed: true }, { provider: "mock", latency: 30 }),
      trace("mock_ok_2", 0, "gpt-5-mini", { verifierUsed: true, verifierPassed: true }, { provider: "mock", latency: 35 }),
    ], { maxErrorRate: 0.1, maxP95LatencyMs: 1000 });
    const routed = applySloRouting({
      selectedProvider: "groq",
      selectedModel: "gpt-5-mini",
      originalRequestedModel: "gpt-5.5",
      downgraded: true,
      escalated: false,
      reason: "base",
    }, policy, { fallbackProviders: ["mock"] });
    expect(policy.providers.groq.eligible).toBe(false);
    expect(policy.providers.mock.eligible).toBe(true);
    expect(routed.selectedProvider).toBe("mock");
    expect(routed.reason).toContain("SLO reroute");
  });
});

function trace(
  id: string,
  cost: number,
  selectedModel = "gpt-5-mini",
  quality: RequestTrace["quality"] = { verifierUsed: false, verifierPassed: true },
  over: { provider?: string; source?: RequestTrace["finalResponseSource"]; latency?: number } = {},
): RequestTrace {
  const provider = over.provider ?? "groq";
  return {
    id,
    timestamp: new Date().toISOString(),
    workloadType: "docs_qa",
    requestedModel: "gpt-5.5",
    selectedModel,
    selectedProvider: provider,
    inputTokensEstimated: 10,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    outputTokensEstimated: over.latency,
    providerLatencyMs: over.latency,
    routing: { selectedProvider: provider, selectedModel, originalRequestedModel: "gpt-5.5", downgraded: true, escalated: false, reason: "test" },
    policy: { allowed: over.source !== "provider_error", reason: "budget policy allowed request" },
    cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: cost, estimatedSavings: 1 - cost },
    quality,
    normalizedHash: id,
    finalResponseSource: over.source ?? "model",
  };
}
