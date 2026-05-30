import type { RequestTrace } from "@tokenops/core";
import { summarizeCosts } from "./cost-ledger.js";

export function gatewayStats(traces: RequestTrace[]) {
  const total = traces.length;
  const exactHits = traces.filter((t) => t.cache.exactHit).length;
  const semanticHits = traces.filter((t) => t.cache.semanticHit).length;
  const downgrades = traces.filter((t) => t.routing.downgraded).length;
  return {
    requests: total,
    exact_cache_hit_rate: total ? exactHits / total : 0,
    semantic_cache_hit_rate: total ? semanticHits / total : 0,
    model_downgrade_rate: total ? downgrades / total : 0,
    cost: summarizeCosts(traces),
  };
}
