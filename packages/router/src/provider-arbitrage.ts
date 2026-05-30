import type { ProviderHealthReport } from "@tokenops/ledger";
import type { ModelRoute } from "./model-router.js";

export interface ProviderArbitrageOptions {
  candidates?: string[];
  minHealthScore?: number;
  maxP95LatencyMs?: number;
}

export function applyProviderArbitrage(
  base: ModelRoute,
  health: ProviderHealthReport,
  opts: ProviderArbitrageOptions = {},
): ModelRoute {
  const candidates = normalizeCandidates(opts.candidates ?? [base.selectedProvider]);
  const minHealthScore = opts.minHealthScore ?? 0.8;
  const maxP95LatencyMs = opts.maxP95LatencyMs ?? Number.MAX_SAFE_INTEGER;
  const eligible = candidates
    .map((provider) => health.providers[provider])
    .filter((provider) => provider !== undefined)
    .filter((provider) => provider.healthScore >= minHealthScore)
    .filter((provider) => provider.p95LatencyMs <= maxP95LatencyMs)
    .sort((a, b) =>
      a.averageOptimizedCostUsd - b.averageOptimizedCostUsd ||
      a.p95LatencyMs - b.p95LatencyMs ||
      b.healthScore - a.healthScore,
    );

  const best = eligible[0];
  if (!best) {
    return {
      ...base,
      reason: `${base.reason}; provider arbitrage skipped: no candidate satisfied health>=${minHealthScore} and p95<=${maxP95LatencyMs}ms`,
    };
  }
  if (best.provider === base.selectedProvider) return base;
  return {
    ...base,
    selectedProvider: best.provider,
    reason: `${base.reason}; provider arbitrage selected ${best.provider} avg_cost=${best.averageOptimizedCostUsd} p95=${best.p95LatencyMs}ms health=${best.healthScore}`,
  };
}

function normalizeCandidates(candidates: string[]): string[] {
  return [...new Set(candidates.flatMap((candidate) => candidate.split(",")).map((candidate) => candidate.trim()).filter(Boolean))];
}
