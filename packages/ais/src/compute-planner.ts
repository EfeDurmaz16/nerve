import type { ComputePlan, NormalizedRequest, RiskLevel } from "@tokenops/core";
import type { ModelRoute } from "@tokenops/router";
import type { PolicyDecision } from "@tokenops/policy";
import { foregroundFor } from "./foreground-path.js";
import { backgroundTasksFor } from "./background-scheduler.js";

export function planCompute(input: {
  request: NormalizedRequest;
  exactHit: boolean;
  semanticHit: boolean;
  prefixCacheEligibleTokens: number;
  route: ModelRoute;
  policy: PolicyDecision;
  expectedCostUsd: number;
  riskLevel: RiskLevel;
}): ComputePlan {
  const foregroundAction = foregroundFor({ exactHit: input.exactHit, semanticHit: input.semanticHit, budgetAllowed: input.policy.allowed });
  return {
    requestId: input.request.id,
    foregroundAction,
    backgroundTasks: backgroundTasksFor({ semanticHit: input.semanticHit, riskLevel: input.riskLevel, repeatedContextTokens: input.prefixCacheEligibleTokens }),
    modelRoute: {
      primary: input.route.selectedModel,
      fallback: input.route.fallback,
      verifier: input.riskLevel === "high" || input.semanticHit ? "heuristic-verifier" : undefined,
    },
    cacheStrategy: {
      exact: true,
      semantic: input.semanticHit || input.riskLevel === "low",
      toolResult: input.request.tools.length > 0,
      contextBlock: true,
      prefixSimulation: true,
    },
    contextStrategy: {
      dedupeRepeatedContext: input.prefixCacheEligibleTokens > 0,
      prefixCacheEligibleTokens: input.prefixCacheEligibleTokens,
    },
    expected: {
      latencyMs: foregroundAction.includes("cache") ? 20 : input.riskLevel === "high" ? 1500 : 500,
      costUsd: foregroundAction.includes("cache") ? 0 : input.expectedCostUsd,
      risk: input.riskLevel,
    },
    reason: `${input.policy.reason}; ${input.route.reason}`,
  };
}
