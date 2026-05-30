import type { Complexity, NormalizedRequest, RiskLevel, WorkloadType } from "@tokenops/core";

export interface ModelRoute {
  selectedProvider: string;
  selectedModel: string;
  originalRequestedModel: string;
  downgraded: boolean;
  escalated: boolean;
  fallback?: string;
  reason: string;
}

export function routeModel(input: {
  request: NormalizedRequest;
  workloadType: WorkloadType;
  complexity: Complexity;
  riskLevel: RiskLevel;
  budgetAction?: "allow" | "block" | "downgrade" | "require_verifier";
}): ModelRoute {
  const requested = input.request.requested_model;
  if (input.budgetAction === "downgrade") return route(requested, "gpt-5-mini", "mock", true, false, "budget policy requested downgrade");
  if (input.riskLevel === "high") return route(requested, stronger(requested), "mock", false, stronger(requested) !== requested, "high-risk workload uses stronger model/verifier path");
  if (["docs_qa", "support_faq", "classification", "extraction"].includes(input.workloadType) && input.complexity !== "high") {
    return route(requested, "gpt-5-mini", "mock", requested !== "gpt-5-mini", false, "safe low-complexity workload can use cheaper model");
  }
  return route(requested, requested, "mock", false, false, "requested model retained");
}

function route(original: string, selected: string, provider: string, downgraded: boolean, escalated: boolean, reason: string): ModelRoute {
  return { selectedProvider: provider, selectedModel: selected, originalRequestedModel: original, downgraded, escalated, fallback: escalated ? "gpt-5-mini" : "gpt-5.5", reason };
}

function stronger(model: string): string {
  if (model.includes("mini") || model.includes("haiku") || model === "mock") return "gpt-5.5";
  return model;
}
