import type { BenchmarkResult } from "@tokenops/core";

export function formatBenchmark(result: BenchmarkResult): string {
  const reduction = result.baseline_cost === 0 ? 0 : ((result.estimated_savings / result.baseline_cost) * 100).toFixed(1);
  return [
    `Dataset: ${result.dataset}`,
    `Baseline: requests=${result.total_requests} model_calls=${result.baseline_model_calls ?? result.total_requests} estimated_cost=$${result.baseline_cost}`,
    `Optimized: model_calls=${result.optimized_model_calls ?? "n/a"} estimated_cost=$${result.optimized_cost} cost_reduction=${reduction}%`,
    `Cache: exact=${pct(result.exact_cache_hit_rate)} semantic=${pct(result.semantic_cache_hit_rate)} tool=${pct(result.tool_result_reuse_rate)} context=${pct(result.context_block_reuse_rate ?? 0)}`,
    `Routing: downgraded=${pct(result.model_downgrade_rate)} verifier_escalation=${pct(result.verifier_escalation_rate)}`,
    `Tokens: input_saved=${result.estimated_input_tokens_saved ?? 0} output_saved=${result.estimated_output_tokens_saved ?? 0} prefix_eligible=${result.prefix_cache_eligible_tokens ?? 0}`,
    `Latency: p50=${result.p50_latency_estimate}ms p95=${result.p95_latency_estimate}ms`,
    `Wrong-cache incidents: ${result.wrong_cache_incidents}`,
    ...(result.quality_warnings?.length ? [`Quality warnings: ${result.quality_warnings.join("; ")}`] : []),
  ].join("\n");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
