import type { BudgetPolicy, CostEstimate, NormalizedRequest, RiskLevel } from "@tokenops/core";

export interface PolicyDecision {
  action: "allow" | "block" | "downgrade" | "require_verifier" | "serve_cache" | "ask_clarification";
  allowed: boolean;
  reason: string;
  budgetRemaining?: number;
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  policy_id: "local-default",
  daily_budget_usd: 10,
  max_request_cost_usd: 0.5,
  max_model: "gpt-5.5",
  allow_expensive_models: true,
  block_on_budget_exceeded: true,
  warn_threshold: 0.8,
};

export function evaluateBudgetPolicy(input: {
  request: NormalizedRequest;
  estimate: CostEstimate;
  policy?: BudgetPolicy;
  spentTodayUsd?: number;
  riskLevel?: RiskLevel;
}): PolicyDecision {
  const policy = input.policy ?? DEFAULT_BUDGET_POLICY;
  const remaining = Math.max(0, policy.daily_budget_usd - (input.spentTodayUsd ?? 0));
  if (input.estimate.totalCostUsd > policy.max_request_cost_usd) {
    return policy.block_on_budget_exceeded
      ? { action: "block", allowed: false, reason: `estimated request cost exceeds max_request_cost_usd (${policy.max_request_cost_usd})`, budgetRemaining: remaining }
      : { action: "downgrade", allowed: true, reason: "estimated request cost exceeds request cap; downgrade required", budgetRemaining: remaining };
  }
  if (remaining <= 0) return { action: "block", allowed: false, reason: "daily budget exhausted", budgetRemaining: 0 };
  if (input.riskLevel === "high") return { action: "require_verifier", allowed: true, reason: "high-risk workload requires verifier", budgetRemaining: remaining };
  if (remaining < policy.daily_budget_usd * (1 - policy.warn_threshold)) return { action: "downgrade", allowed: true, reason: "daily budget is near threshold", budgetRemaining: remaining };
  return { action: "allow", allowed: true, reason: "budget policy allowed request", budgetRemaining: remaining };
}
