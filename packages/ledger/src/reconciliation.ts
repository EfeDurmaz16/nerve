import type { CostEstimate, ModelResponse, RequestTrace } from "@tokenops/core";
import { estimateCost } from "@tokenops/core";

export interface UsageReconciliation {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  recordedCostUsd: number;
  deltaUsd: number;
  status: "matched" | "drift";
  reason: string;
}

export function reconcileModelResponseCost(response: ModelResponse, toleranceUsd = 0.000001): UsageReconciliation {
  const estimate: CostEstimate = estimateCost(response.model, response.input_tokens, response.output_tokens);
  const delta = round6(response.cost_usd - estimate.totalCostUsd);
  const matched = Math.abs(delta) <= toleranceUsd;
  return {
    provider: response.provider,
    model: response.model,
    promptTokens: response.input_tokens,
    completionTokens: response.output_tokens,
    estimatedCostUsd: estimate.totalCostUsd,
    recordedCostUsd: response.cost_usd,
    deltaUsd: delta,
    status: matched ? "matched" : "drift",
    reason: matched
      ? "recorded cost matches local pricing estimate within tolerance"
      : "recorded cost differs from local pricing estimate; update pricing config or reconcile against provider invoice",
  };
}

export interface ProviderUsageRecord {
  provider: string;
  model: string;
  traceId?: string;
  requestHash?: string;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
  invoiceId?: string;
  timestamp?: string;
}

export interface ProviderUsageReconciliationRecord {
  provider: string;
  model: string;
  traceId?: string;
  requestHash?: string;
  status: "matched" | "drift" | "missing_trace";
  estimatedTraceCostUsd: number;
  actualCostUsd: number;
  deltaUsd: number;
  reason: string;
}

export interface ProviderUsageReconciliationReport {
  totalUsageRecords: number;
  matched: number;
  drifted: number;
  missingTrace: number;
  estimatedTraceCostUsd: number;
  actualCostUsd: number;
  deltaUsd: number;
  records: ProviderUsageReconciliationRecord[];
}

export function reconcileProviderUsage(
  traces: RequestTrace[],
  usage: ProviderUsageRecord[],
  opts: { toleranceUsd?: number } = {},
): ProviderUsageReconciliationReport {
  const toleranceUsd = opts.toleranceUsd ?? 0.000001;
  const byTraceId = new Map(traces.map((trace) => [trace.id, trace]));
  const byRequestHash = new Map(traces.map((trace) => [trace.normalizedHash, trace]));
  const records = usage.map((record) => {
    const trace = (record.traceId ? byTraceId.get(record.traceId) : undefined)
      ?? (record.requestHash ? byRequestHash.get(record.requestHash) : undefined);
    if (!trace) {
      return {
        provider: record.provider,
        model: record.model,
        traceId: record.traceId,
        requestHash: record.requestHash,
        status: "missing_trace" as const,
        estimatedTraceCostUsd: 0,
        actualCostUsd: round6(record.actualCostUsd),
        deltaUsd: round6(record.actualCostUsd),
        reason: "provider usage record does not match a stored TokenOps trace",
      };
    }
    const estimatedTraceCostUsd = Math.max(0, trace.cost.estimatedOptimizedCost);
    const deltaUsd = round6(record.actualCostUsd - estimatedTraceCostUsd);
    const matched = Math.abs(deltaUsd) <= toleranceUsd;
    return {
      provider: record.provider,
      model: record.model,
      traceId: trace.id,
      requestHash: trace.normalizedHash,
      status: matched ? "matched" as const : "drift" as const,
      estimatedTraceCostUsd: round6(estimatedTraceCostUsd),
      actualCostUsd: round6(record.actualCostUsd),
      deltaUsd,
      reason: matched
        ? "provider usage matches TokenOps trace estimate within tolerance"
        : "provider usage differs from TokenOps trace estimate; inspect pricing config, provider billing, or cache accounting",
    };
  });

  const estimatedTraceCostUsd = round6(records.reduce((sum, record) => sum + record.estimatedTraceCostUsd, 0));
  const actualCostUsd = round6(records.reduce((sum, record) => sum + record.actualCostUsd, 0));
  return {
    totalUsageRecords: records.length,
    matched: records.filter((record) => record.status === "matched").length,
    drifted: records.filter((record) => record.status === "drift").length,
    missingTrace: records.filter((record) => record.status === "missing_trace").length,
    estimatedTraceCostUsd,
    actualCostUsd,
    deltaUsd: round6(actualCostUsd - estimatedTraceCostUsd),
    records,
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
