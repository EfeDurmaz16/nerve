import type { RequestTrace } from "@tokenops/core";
import type { ModelRoute } from "./model-router.js";

export interface ProviderSlo {
  provider: string;
  samples: number;
  errorRate: number;
  p95LatencyMs: number;
  averageCostUsd: number;
  eligible: boolean;
  reason: string;
}

export interface SloRoutingPolicy {
  generatedAt: string;
  windowSize: number;
  maxErrorRate: number;
  maxP95LatencyMs: number;
  maxAverageCostUsd: number;
  providers: Record<string, ProviderSlo>;
}

export function learnSloRoutingPolicy(
  traces: RequestTrace[],
  opts: { windowSize?: number; maxErrorRate?: number; maxP95LatencyMs?: number; maxAverageCostUsd?: number } = {},
): SloRoutingPolicy {
  const windowSize = opts.windowSize ?? 100;
  const maxErrorRate = opts.maxErrorRate ?? 0.1;
  const maxP95LatencyMs = opts.maxP95LatencyMs ?? 10_000;
  const maxAverageCostUsd = opts.maxAverageCostUsd ?? Number.MAX_SAFE_INTEGER;
  const recent = traces.slice(0, windowSize);
  const buckets = new Map<string, RequestTrace[]>();
  for (const trace of recent) {
    const provider = trace.selectedProvider || trace.routing.selectedProvider || "unknown";
    buckets.set(provider, [...(buckets.get(provider) ?? []), trace]);
  }
  const providers: Record<string, ProviderSlo> = {};
  for (const [provider, rows] of buckets) {
    const errors = rows.filter((trace) => trace.finalResponseSource === "provider_error" || !trace.policy.allowed).length;
    const errorRate = rate(errors, rows.length);
    const p95LatencyMs = percentile(rows.map((trace) => latencyForTrace(trace)).sort((a, b) => a - b), 0.95);
    const averageCostUsd = avg(rows.map((trace) => trace.cost.estimatedOptimizedCost));
    const eligible = errorRate <= maxErrorRate && p95LatencyMs <= maxP95LatencyMs && averageCostUsd <= maxAverageCostUsd;
    providers[provider] = {
      provider,
      samples: rows.length,
      errorRate,
      p95LatencyMs,
      averageCostUsd,
      eligible,
      reason: eligible
        ? "provider satisfies local SLO window"
        : `provider violates SLO window: error_rate=${errorRate} p95_latency_ms=${p95LatencyMs} average_cost_usd=${averageCostUsd}`,
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    windowSize,
    maxErrorRate,
    maxP95LatencyMs,
    maxAverageCostUsd,
    providers,
  };
}

export function applySloRouting(
  base: ModelRoute,
  policy: SloRoutingPolicy,
  opts: { fallbackProviders?: string[] } = {},
): ModelRoute {
  const currentProvider = primaryProvider(base.selectedProvider);
  const current = policy.providers[currentProvider];
  if (!current || current.eligible) return base;
  const fallback = (opts.fallbackProviders ?? [])
    .map((provider) => policy.providers[provider])
    .find((provider) => provider?.eligible);
  if (!fallback) {
    return { ...base, reason: `${base.reason}; SLO warning: ${current.reason}; no eligible fallback provider found` };
  }
  return {
    ...base,
    selectedProvider: fallback.provider,
    reason: `${base.reason}; SLO reroute from ${currentProvider} to ${fallback.provider}: ${current.reason}`,
  };
}

function primaryProvider(provider: string): string {
  return provider.split(",").map((part) => part.trim()).filter(Boolean)[0] ?? provider;
}

function latencyForTrace(trace: RequestTrace): number {
  if (typeof trace.providerLatencyMs === "number") return trace.providerLatencyMs;
  const raw = trace.cost.estimatedOptimizedCost === 0 && (trace.cache.exactHit || trace.cache.semanticHit) ? 20 : undefined;
  return trace.outputTokensEstimated ?? raw ?? trace.inputTokensEstimated;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return round6(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : round6(n / d);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
