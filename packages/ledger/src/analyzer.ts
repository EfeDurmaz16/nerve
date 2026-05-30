import type { RequestTrace } from "@tokenops/core";

export interface CheaperInsight {
  traceId: string;
  kind: "overkill_model" | "prefix_cache" | "repeated_context" | "cache_opportunity";
  message: string;
  estimatedAvoidableCostUsd: number;
}

export function analyzeTraces(traces: RequestTrace[], traceId?: string): CheaperInsight[] {
  const selected = traceId ? traces.filter((t) => t.id === traceId) : traces;
  const insights: CheaperInsight[] = [];
  for (const trace of selected) {
    if (trace.routing.downgraded || /docs_qa|support_faq|classification/.test(trace.workloadType)) {
      insights.push({
        traceId: trace.id,
        kind: "overkill_model",
        message: `This request used ${trace.requestedModel}. It likely could have used ${trace.selectedModel}.`,
        estimatedAvoidableCostUsd: Math.max(0, trace.cost.estimatedSavings),
      });
    }
    if (trace.cache.prefixCacheEligibleTokens > 1000) {
      insights.push({
        traceId: trace.id,
        kind: "prefix_cache",
        message: `Stable prefix was ${trace.cache.prefixCacheEligibleTokens} tokens. Provider prefix caching could reduce input cost.`,
        estimatedAvoidableCostUsd: Math.max(0, trace.cost.estimatedBaselineCost * 0.3),
      });
    }
    if (!trace.cache.exactHit && !trace.cache.semanticHit && trace.finalResponseSource === "model") {
      insights.push({
        traceId: trace.id,
        kind: "cache_opportunity",
        message: "This model call was not served from cache; check exact, semantic, tool-result, or context-block reuse opportunities.",
        estimatedAvoidableCostUsd: Math.max(0, trace.cost.estimatedOptimizedCost * 0.2),
      });
    }
  }
  return insights;
}
