import type { RequestTrace, RiskLevel, WorkloadType } from "@tokenops/core";
import type { ProviderHealthReport } from "@tokenops/ledger";
import type { ModelRoute } from "./model-router.js";

export interface LearnedRoutingRule {
  workloadType: WorkloadType;
  riskLevel: RiskLevel;
  selectedProvider: string;
  selectedModel: string;
  samples: number;
  averageOptimizedCost: number;
  averageSavings: number;
  verifierPassRate: number;
  failureRate: number;
  reason: string;
}

export interface LearnedRoutingPolicy {
  generatedAt: string;
  minSamples: number;
  minVerifierPassRate: number;
  rules: LearnedRoutingRule[];
}

export function learnRoutingPolicy(traces: RequestTrace[], opts: { minSamples?: number; minVerifierPassRate?: number } = {}): LearnedRoutingPolicy {
  const minSamples = opts.minSamples ?? 2;
  const minVerifierPassRate = opts.minVerifierPassRate ?? 0.8;
  const buckets = new Map<string, RequestTrace[]>();
  for (const trace of traces) {
    if (!trace.policy.allowed) continue;
    if (trace.finalResponseSource === "blocked") continue;
    const risk = riskFromTrace(trace);
    const key = [trace.workloadType, risk, trace.selectedProvider, trace.selectedModel].join("|");
    buckets.set(key, [...(buckets.get(key) ?? []), trace]);
  }

  const candidates = [...buckets.entries()]
    .map(([key, rows]) => {
      const [workloadType, riskLevel, selectedProvider, selectedModel] = key.split("|") as [
        WorkloadType,
        RiskLevel,
        string,
        string,
      ];
      const verifierPassRate = qualityPassRate(rows);
      const failureRate = rate(rows.filter((r) => r.quality?.verifierPassed === false).length, rows.length);
      const averageOptimizedCost = avg(rows.map((r) => r.cost.estimatedOptimizedCost));
      const averageSavings = avg(rows.map((r) => r.cost.estimatedSavings));
      return {
        workloadType,
        riskLevel,
        selectedProvider,
        selectedModel,
        samples: rows.length,
        averageOptimizedCost,
        averageSavings,
        verifierPassRate,
        failureRate,
        reason: `learned from ${rows.length} traces; avg_cost=${round6(averageOptimizedCost)} avg_savings=${round6(averageSavings)} verifier_pass_rate=${verifierPassRate}`,
      };
    })
    .filter((rule) => rule.samples >= minSamples)
    .filter((rule) => rule.verifierPassRate >= minVerifierPassRate);

  const bestByWorkload = new Map<string, LearnedRoutingRule>();
  for (const rule of candidates) {
    const key = `${rule.workloadType}|${rule.riskLevel}`;
    const prev = bestByWorkload.get(key);
    if (!prev || rule.averageOptimizedCost < prev.averageOptimizedCost) bestByWorkload.set(key, rule);
  }

  return {
    generatedAt: new Date().toISOString(),
    minSamples,
    minVerifierPassRate,
    rules: [...bestByWorkload.values()],
  };
}

export function applyLearnedRouting(
  base: ModelRoute,
  traceLike: { workloadType: WorkloadType; riskLevel: RiskLevel },
  policy: LearnedRoutingPolicy,
  opts: { providerHealth?: ProviderHealthReport; minProviderHealthScore?: number } = {},
): ModelRoute {
  const rule = policy.rules.find((r) => r.workloadType === traceLike.workloadType && r.riskLevel === traceLike.riskLevel);
  if (!rule) return base;
  const minProviderHealthScore = opts.minProviderHealthScore ?? 0;
  const health = opts.providerHealth?.providers[rule.selectedProvider];
  if (health && health.healthScore < minProviderHealthScore) {
    return {
      ...base,
      reason: `${base.reason}; learned routing skipped: provider health below threshold (${rule.selectedProvider}=${health.healthScore}, threshold=${minProviderHealthScore})`,
    };
  }
  return {
    ...base,
    selectedProvider: rule.selectedProvider,
    selectedModel: rule.selectedModel,
    downgraded: base.originalRequestedModel !== rule.selectedModel,
    escalated: false,
    reason: `learned routing policy: ${rule.reason}`,
  };
}

function riskFromTrace(trace: RequestTrace): RiskLevel {
  if (trace.workloadType === "high_risk_action") return "high";
  if (trace.policy.reason.includes("high-risk")) return "high";
  return "low";
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return round6(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function qualityPassRate(rows: RequestTrace[]): number {
  const judged = rows.filter((row) => row.quality?.verifierPassed !== undefined);
  if (judged.length === 0) return 1;
  return rate(judged.filter((row) => row.quality?.verifierPassed === true).length, judged.length);
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : round6(n / d);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
