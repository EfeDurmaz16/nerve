import type { RequestTrace } from "@tokenops/core";
import { redactTrace } from "./trace-store.js";

export interface OtelSpanExport {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: "tokenops.inference";
  kind: "SPAN_KIND_SERVER";
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  status: {
    code: "STATUS_CODE_OK" | "STATUS_CODE_ERROR";
    message?: string;
  };
}

export function exportTracesAsOtelSpans(traces: RequestTrace[]): OtelSpanExport[] {
  return traces.map((rawTrace) => {
    const trace = redactTrace(rawTrace);
    const startMs = Date.parse(trace.timestamp);
    const latencyMs = Math.max(0, trace.providerLatencyMs ?? 0);
    const startTimeUnixNano = msToNano(Number.isFinite(startMs) ? startMs : 0);
    const endTimeUnixNano = msToNano((Number.isFinite(startMs) ? startMs : 0) + latencyMs);
    return {
      traceId: trace.id,
      spanId: spanIdFromTraceId(trace.id),
      name: "tokenops.inference",
      kind: "SPAN_KIND_SERVER",
      startTimeUnixNano,
      endTimeUnixNano,
      attributes: {
        "tokenops.workload_type": trace.workloadType,
        "tokenops.provider": trace.selectedProvider,
        "tokenops.model": trace.selectedModel,
        "tokenops.requested_model": trace.requestedModel,
        "tokenops.final_response_source": trace.finalResponseSource,
        "tokenops.cache.exact_hit": trace.cache.exactHit,
        "tokenops.cache.semantic_hit": trace.cache.semanticHit,
        "tokenops.cache.tool_result_hit": trace.cache.toolResultHit,
        "tokenops.cache.context_block_hit": trace.cache.contextBlockHit,
        "tokenops.cache.prefix_eligible_tokens": trace.cache.prefixCacheEligibleTokens,
        "tokenops.routing.downgraded": trace.routing.downgraded,
        "tokenops.routing.escalated": trace.routing.escalated,
        "tokenops.routing.reason": trace.routing.reason,
        "tokenops.policy.allowed": trace.policy.allowed,
        "tokenops.policy.reason": trace.policy.reason,
        "tokenops.tokens.input_estimated": trace.inputTokensEstimated,
        "tokenops.tokens.output_estimated": trace.outputTokensEstimated ?? 0,
        "tokenops.latency.provider_ms": latencyMs,
        "tokenops.cost.baseline_usd": trace.cost.estimatedBaselineCost,
        "tokenops.cost.optimized_usd": trace.cost.estimatedOptimizedCost,
        "tokenops.cost.estimated_savings_usd": trace.cost.estimatedSavings,
        "tokenops.quality.verifier_used": trace.quality?.verifierUsed ?? false,
        "tokenops.quality.verifier_passed": trace.quality?.verifierPassed ?? false,
      },
      status: trace.policy.allowed && trace.finalResponseSource !== "provider_error"
        ? { code: "STATUS_CODE_OK" }
        : { code: "STATUS_CODE_ERROR", message: trace.policy.reason },
    };
  });
}

export function formatOtelSpansJsonl(spans: OtelSpanExport[]): string {
  return spans.map((span) => JSON.stringify(span)).join("\n") + (spans.length > 0 ? "\n" : "");
}

function msToNano(ms: number): string {
  return String(Math.max(0, Math.floor(ms)) * 1_000_000);
}

function spanIdFromTraceId(traceId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < traceId.length; i++) {
    hash ^= traceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(16, "0").slice(0, 16);
}
