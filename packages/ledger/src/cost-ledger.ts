import type { RequestTrace } from "@tokenops/core";

export interface CostSummary {
  totalRequests: number;
  baselineCost: number;
  optimizedCost: number;
  estimatedSavings: number;
  byModel: Record<string, number>;
  byProvider: Record<string, number>;
  byUser: Record<string, number>;
  byAgent: Record<string, number>;
}

export function summarizeCosts(traces: RequestTrace[]): CostSummary {
  const out: CostSummary = {
    totalRequests: traces.length,
    baselineCost: 0,
    optimizedCost: 0,
    estimatedSavings: 0,
    byModel: {},
    byProvider: {},
    byUser: {},
    byAgent: {},
  };
  for (const trace of traces) {
    out.baselineCost += trace.cost.estimatedBaselineCost;
    out.optimizedCost += trace.cost.estimatedOptimizedCost;
    out.estimatedSavings += trace.cost.estimatedSavings;
    add(out.byModel, trace.selectedModel, trace.cost.estimatedOptimizedCost);
    add(out.byProvider, trace.selectedProvider, trace.cost.estimatedOptimizedCost);
    if (trace.userId) add(out.byUser, trace.userId, trace.cost.estimatedOptimizedCost);
    if (trace.agentId) add(out.byAgent, trace.agentId, trace.cost.estimatedOptimizedCost);
  }
  out.baselineCost = round6(out.baselineCost);
  out.optimizedCost = round6(out.optimizedCost);
  out.estimatedSavings = round6(out.estimatedSavings);
  return out;
}

function add(target: Record<string, number>, key: string, value: number): void {
  target[key] = round6((target[key] ?? 0) + value);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
