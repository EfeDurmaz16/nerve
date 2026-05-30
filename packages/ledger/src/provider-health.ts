import type { RequestTrace } from "@tokenops/core";

export interface ProviderHealth {
  provider: string;
  requests: number;
  blockedRate: number;
  verifierPassRate: number;
  averageOptimizedCostUsd: number;
  p95LatencyMs: number;
  cacheHitRate: number;
  healthScore: number;
}

export interface ProviderHealthReport {
  generatedAt: string;
  providers: Record<string, ProviderHealth>;
}

export function providerHealthReport(traces: RequestTrace[]): ProviderHealthReport {
  const buckets = new Map<string, RequestTrace[]>();
  for (const trace of traces) {
    const provider = trace.selectedProvider || trace.routing.selectedProvider || "unknown";
    buckets.set(provider, [...(buckets.get(provider) ?? []), trace]);
  }

  const providers: Record<string, ProviderHealth> = {};
  for (const [provider, rows] of buckets) {
    const requests = rows.length;
    const blockedRate = rate(rows.filter((row) => !row.policy.allowed || row.finalResponseSource === "blocked").length, requests);
    const judged = rows.filter((row) => row.quality?.verifierPassed !== undefined);
    const verifierPassRate = judged.length === 0 ? 1 : rate(judged.filter((row) => row.quality?.verifierPassed === true).length, judged.length);
    const averageOptimizedCostUsd = avg(rows.map((row) => row.cost.estimatedOptimizedCost));
    const p95LatencyMs = percentile(rows.map(latencyForTrace).sort((a, b) => a - b), 0.95);
    const cacheHitRate = rate(rows.filter((row) => row.cache.exactHit || row.cache.semanticHit || row.cache.toolResultHit).length, requests);
    const costPenalty = Math.min(0.25, averageOptimizedCostUsd);
    const healthScore = clamp(round4(verifierPassRate * 0.65 + (1 - blockedRate) * 0.2 + cacheHitRate * 0.15 - costPenalty), 0, 1);
    providers[provider] = {
      provider,
      requests,
      blockedRate,
      verifierPassRate,
      averageOptimizedCostUsd,
      p95LatencyMs,
      cacheHitRate,
      healthScore,
    };
  }

  return { generatedAt: new Date().toISOString(), providers };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return round6(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : round4(n / d);
}

function latencyForTrace(trace: RequestTrace): number {
  if (typeof trace.providerLatencyMs === "number") return trace.providerLatencyMs;
  if (trace.cost.estimatedOptimizedCost === 0 && (trace.cache.exactHit || trace.cache.semanticHit || trace.cache.toolResultHit)) return 20;
  return trace.outputTokensEstimated ?? trace.inputTokensEstimated;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
