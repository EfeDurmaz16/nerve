import type { BudgetPolicy, CostEstimate, NormalizedRequest, RequestTrace, RiskLevel } from "@tokenops/core";
import { DEFAULT_BUDGET_POLICY, evaluateBudgetPolicy, type PolicyDecision } from "./budget-policy.js";

export interface PolicySimulationDecision {
  traceId: string;
  action: PolicyDecision["action"];
  allowed: boolean;
  reason: string;
  originalCostUsd: number;
  simulatedCostUsd: number;
  avoidedCostUsd: number;
  userId?: string;
  agentId?: string;
  workloadType: RequestTrace["workloadType"];
}

export interface PolicySimulationResult {
  totalTraces: number;
  allowed: number;
  blocked: number;
  downgraded: number;
  requireVerifier: number;
  estimatedBaselineCostUsd: number;
  estimatedAllowedCostUsd: number;
  estimatedAvoidedCostUsd: number;
  decisions: PolicySimulationDecision[];
}

export function simulateBudgetPolicy(
  traces: RequestTrace[],
  opts: { policy?: BudgetPolicy } = {},
): PolicySimulationResult {
  const policy = opts.policy ?? DEFAULT_BUDGET_POLICY;
  const spentByScope = new Map<string, number>();
  const decisions: PolicySimulationDecision[] = [];

  for (const trace of traces.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const scope = policyScope(trace);
    const spentTodayUsd = spentByScope.get(scope) ?? 0;
    const originalCostUsd = Math.max(0, trace.cost.estimatedBaselineCost);
    const optimizedCostUsd = Math.max(0, trace.cost.estimatedOptimizedCost);
    const decision = evaluateBudgetPolicy({
      request: requestFromTrace(trace),
      estimate: estimateFromTrace(trace, originalCostUsd),
      policy: policyForTrace(policy, trace),
      spentTodayUsd,
      riskLevel: riskFromTrace(trace),
    });
    const simulatedCostUsd = simulatedCostForDecision(decision, originalCostUsd, optimizedCostUsd);
    if (decision.allowed) spentByScope.set(scope, spentTodayUsd + simulatedCostUsd);
    decisions.push({
      traceId: trace.id,
      action: decision.action,
      allowed: decision.allowed,
      reason: decision.reason,
      originalCostUsd,
      simulatedCostUsd,
      avoidedCostUsd: Math.max(0, originalCostUsd - simulatedCostUsd),
      userId: trace.userId,
      agentId: trace.agentId,
      workloadType: trace.workloadType,
    });
  }

  const estimatedBaselineCostUsd = decisions.reduce((sum, decision) => sum + decision.originalCostUsd, 0);
  const estimatedAllowedCostUsd = decisions.reduce((sum, decision) => sum + decision.simulatedCostUsd, 0);
  return {
    totalTraces: decisions.length,
    allowed: decisions.filter((decision) => decision.action === "allow").length,
    blocked: decisions.filter((decision) => decision.action === "block").length,
    downgraded: decisions.filter((decision) => decision.action === "downgrade").length,
    requireVerifier: decisions.filter((decision) => decision.action === "require_verifier").length,
    estimatedBaselineCostUsd,
    estimatedAllowedCostUsd,
    estimatedAvoidedCostUsd: Math.max(0, estimatedBaselineCostUsd - estimatedAllowedCostUsd),
    decisions,
  };
}

function simulatedCostForDecision(
  decision: PolicyDecision,
  originalCostUsd: number,
  optimizedCostUsd: number,
): number {
  if (!decision.allowed) return 0;
  if (decision.action === "downgrade") return optimizedCostUsd;
  return originalCostUsd;
}

function policyScope(trace: RequestTrace): string {
  const day = trace.timestamp.slice(0, 10);
  if (trace.userId) return `${day}:user:${trace.userId}`;
  if (trace.agentId) return `${day}:agent:${trace.agentId}`;
  return `${day}:global`;
}

function policyForTrace(policy: BudgetPolicy, trace: RequestTrace): BudgetPolicy {
  return {
    ...policy,
    user_id: trace.userId ?? policy.user_id,
    agent_id: trace.agentId ?? policy.agent_id,
  };
}

function estimateFromTrace(trace: RequestTrace, originalCostUsd: number): CostEstimate {
  const inputTokens = Math.max(0, trace.inputTokensEstimated);
  const outputTokens = Math.max(0, trace.outputTokensEstimated ?? 0);
  const totalTokens = Math.max(1, inputTokens + outputTokens);
  return {
    inputTokens,
    outputTokens,
    inputCostUsd: originalCostUsd * (inputTokens / totalTokens),
    outputCostUsd: originalCostUsd * (outputTokens / totalTokens),
    totalCostUsd: originalCostUsd,
  };
}

function requestFromTrace(trace: RequestTrace): NormalizedRequest {
  return {
    id: `sim_${trace.id}`,
    provider: trace.selectedProvider,
    requested_model: trace.requestedModel,
    messages: [{ role: "user", content: `replay trace ${trace.id}` }],
    tools: [],
    temperature: 0,
    response_format: null,
    metadata: { simulation: true, source_trace_id: trace.id },
    user_id: trace.userId,
    agent_id: trace.agentId,
    workload_type: trace.workloadType,
    risk_level: riskFromTrace(trace),
    normalized_hash: trace.normalizedHash,
    created_at: trace.timestamp,
    max_output_tokens: trace.outputTokensEstimated,
  };
}

function riskFromTrace(trace: RequestTrace): RiskLevel {
  if (trace.workloadType === "high_risk_action") return "high";
  if (trace.workloadType === "code_modification" || trace.workloadType === "agent_tool_reasoning") return "medium";
  return "low";
}
