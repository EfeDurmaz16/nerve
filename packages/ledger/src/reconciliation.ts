import type { CostEstimate, ModelResponse } from "@tokenops/core";
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

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
