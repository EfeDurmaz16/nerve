import type { RequestTrace } from "@tokenops/core";

export interface LoopSignal {
  action: "ok" | "warn" | "block" | "compress_trace" | "require_approval";
  reason: string;
}

export function detectAgentLoop(traces: RequestTrace[], agentId?: string): LoopSignal {
  const scoped = agentId ? traces.filter((t) => t.agentId === agentId) : traces;
  const recent = scoped.slice(0, 10);
  const byHash = new Map<string, number>();
  for (const trace of recent) byHash.set(trace.normalizedHash, (byHash.get(trace.normalizedHash) ?? 0) + 1);
  const maxRepeat = Math.max(0, ...byHash.values());
  if (maxRepeat >= 6) return { action: "block", reason: `This agent repeated the same prompt ${maxRepeat} times.` };
  if (maxRepeat >= 3) return { action: "warn", reason: `This agent repeated a similar prompt ${maxRepeat} times.` };
  const repeatedContext = recent.reduce((s, t) => s + t.cache.prefixCacheEligibleTokens, 0);
  if (repeatedContext > 18000) return { action: "compress_trace", reason: `This task resent ${repeatedContext} repeated context tokens.` };
  return { action: "ok", reason: "no loop detected" };
}
