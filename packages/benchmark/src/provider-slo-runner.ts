import type { RequestTrace } from "@tokenops/core";
import { applySloRouting, learnSloRoutingPolicy, type ModelRoute, type SloRoutingPolicy } from "@tokenops/router";

export interface ProviderSloBenchmarkResult {
  originalProvider: string;
  selectedProvider: string;
  rerouted: boolean;
  unhealthyProviderEligible: boolean;
  fallbackProviderEligible: boolean;
  unhealthyProviderErrorRate: number;
  unhealthyProviderP95LatencyMs: number;
  fallbackProviderP95LatencyMs: number;
  policy: SloRoutingPolicy;
  route: ModelRoute;
  passed: boolean;
}

export function runProviderSloBenchmark(): ProviderSloBenchmarkResult {
  const traces = [
    trace("groq_error", "groq", 0.001, 18_000, "provider_error", false),
    trace("groq_slow", "groq", 0.001, 15_000, "model", true),
    trace("groq_slow_2", "groq", 0.001, 12_000, "model", true),
    trace("mock_ok_1", "mock", 0, 25, "model", true),
    trace("mock_ok_2", "mock", 0, 30, "model", true),
    trace("mock_ok_3", "mock", 0, 35, "model", true),
  ];
  const policy = learnSloRoutingPolicy(traces, {
    maxErrorRate: 0.1,
    maxP95LatencyMs: 1000,
    maxAverageCostUsd: 0.01,
  });
  const base: ModelRoute = {
    selectedProvider: "groq",
    selectedModel: "gpt-5-mini",
    originalRequestedModel: "gpt-5.5",
    downgraded: true,
    escalated: false,
    reason: "base provider route before SLO policy",
  };
  const route = applySloRouting(base, policy, { fallbackProviders: ["mock"] });
  const unhealthy = policy.providers.groq;
  const fallback = policy.providers.mock;
  const rerouted = route.selectedProvider !== base.selectedProvider;
  return {
    originalProvider: base.selectedProvider,
    selectedProvider: route.selectedProvider,
    rerouted,
    unhealthyProviderEligible: Boolean(unhealthy?.eligible),
    fallbackProviderEligible: Boolean(fallback?.eligible),
    unhealthyProviderErrorRate: unhealthy?.errorRate ?? 0,
    unhealthyProviderP95LatencyMs: unhealthy?.p95LatencyMs ?? 0,
    fallbackProviderP95LatencyMs: fallback?.p95LatencyMs ?? 0,
    policy,
    route,
    passed: rerouted && route.selectedProvider === "mock" && unhealthy?.eligible === false && fallback?.eligible === true,
  };
}

function trace(
  id: string,
  provider: string,
  cost: number,
  latencyMs: number,
  source: RequestTrace["finalResponseSource"],
  allowed: boolean,
): RequestTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    workloadType: "docs_qa",
    requestedModel: "gpt-5.5",
    selectedModel: "gpt-5-mini",
    selectedProvider: provider,
    inputTokensEstimated: 100,
    outputTokensEstimated: 20,
    providerLatencyMs: latencyMs,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: {
      selectedProvider: provider,
      selectedModel: "gpt-5-mini",
      originalRequestedModel: "gpt-5.5",
      downgraded: true,
      escalated: false,
      reason: "synthetic SLO trace",
    },
    policy: { allowed, reason: allowed ? "budget policy allowed request" : "provider error trace" },
    cost: { estimatedBaselineCost: 0.01, estimatedOptimizedCost: cost, estimatedSavings: Math.max(0, 0.01 - cost) },
    quality: { verifierUsed: true, verifierPassed: allowed },
    normalizedHash: id,
    finalResponseSource: source,
  };
}
