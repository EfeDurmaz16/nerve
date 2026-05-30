import type { BenchmarkResult } from "@tokenops/core";
import { replayAll } from "./replay-runner.js";
import { runBatchBenchmark, type BatchBenchmarkResult } from "./batch-runner.js";
import { runLoadBenchmark, type LoadBenchmarkResult } from "./load-runner.js";
import { runProviderThroughputBenchmark, type ProviderThroughputResult } from "./provider-throughput-runner.js";

export interface ReadinessBenchmarkOptions {
  loadRequests?: number;
  loadConcurrency?: number;
  batchRequests?: number;
  throughputRequests?: number;
  throughputConcurrency?: number;
  includeGroq?: boolean;
}

export interface ReadinessBenchmarkReport {
  generatedAt: string;
  summary: {
    readyForLocalDemo: boolean;
    totalReplayRequests: number;
    replayDatasets: number;
    baselineCostUsd: number;
    optimizedCostUsd: number;
    estimatedReplayCostReductionPct: number;
    runtimeAvoidedProviderCalls: number;
    batchingLatencyReductionPct: number;
    mockOutputTokensPerSecond: number;
    groqLiveMeasured: boolean;
  };
  evidence: {
    replay: BenchmarkResult[];
    runtimeCoalescing: LoadBenchmarkResult;
    microBatching: BatchBenchmarkResult;
    mockThroughput: ProviderThroughputResult;
    groqThroughput?: ProviderThroughputResult;
  };
  passed: Record<string, boolean>;
  gaps: string[];
}

export async function runReadinessBenchmark(opts: ReadinessBenchmarkOptions = {}): Promise<ReadinessBenchmarkReport> {
  const replay = await replayAll();
  const runtimeCoalescing = await runLoadBenchmark({
    requests: opts.loadRequests ?? 30,
    concurrency: opts.loadConcurrency ?? 10,
    duplicateRatio: 0.75,
    providerLatencyMs: 8,
    maxConcurrentInference: opts.loadConcurrency ?? 10,
  });
  const microBatching = await runBatchBenchmark({
    requests: opts.batchRequests ?? 24,
    batchSize: 6,
    batchWindowMs: 2,
    perBatchOverheadMs: 10,
    perItemLatencyMs: 1,
  });
  const mockThroughput = await runProviderThroughputBenchmark({
    provider: "mock",
    requests: opts.throughputRequests ?? 12,
    concurrency: opts.throughputConcurrency ?? 4,
    providerLatencyMs: 2,
  });
  const groqThroughput = opts.includeGroq
    ? await runProviderThroughputBenchmark({
      provider: "groq",
      requests: Math.min(opts.throughputRequests ?? 4, 4),
      concurrency: Math.min(opts.throughputConcurrency ?? 2, 2),
    })
    : undefined;

  const baselineCostUsd = sum(replay.map((r) => r.baseline_cost));
  const optimizedCostUsd = sum(replay.map((r) => r.optimized_cost));
  const estimatedReplayCostReductionPct = baselineCostUsd === 0 ? 0 : ((baselineCostUsd - optimizedCostUsd) / baselineCostUsd) * 100;
  const passed = {
    replayShowsSavings: replay.length > 0 && estimatedReplayCostReductionPct > 0,
    exactOrSemanticCacheObserved: replay.some((r) => r.exact_cache_hit_rate > 0 || r.semantic_cache_hit_rate > 0),
    toolOrContextReuseObserved: replay.some((r) => r.tool_result_reuse_rate > 0 || (r.context_block_reuse_rate ?? 0) > 0),
    runtimeCoalescingAvoidsCalls: runtimeCoalescing.avoidedProviderCalls > 0,
    microBatchingReducesLatency: microBatching.estimatedLatencyReduction > 0,
    mockThroughputMeasured: !mockThroughput.skipped && mockThroughput.outputTokensPerSecond > 0,
    groqThroughputAvailableWhenRequested: !opts.includeGroq || Boolean(groqThroughput && !groqThroughput.skipped && groqThroughput.errors === 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      readyForLocalDemo: Object.values(passed).every(Boolean),
      totalReplayRequests: replay.reduce((total, result) => total + result.total_requests, 0),
      replayDatasets: replay.length,
      baselineCostUsd: roundMoney(baselineCostUsd),
      optimizedCostUsd: roundMoney(optimizedCostUsd),
      estimatedReplayCostReductionPct: roundPct(estimatedReplayCostReductionPct),
      runtimeAvoidedProviderCalls: runtimeCoalescing.avoidedProviderCalls,
      batchingLatencyReductionPct: roundPct(microBatching.estimatedLatencyReduction),
      mockOutputTokensPerSecond: mockThroughput.outputTokensPerSecond,
      groqLiveMeasured: Boolean(groqThroughput && !groqThroughput.skipped && groqThroughput.errors === 0),
    },
    evidence: {
      replay,
      runtimeCoalescing,
      microBatching,
      mockThroughput,
      groqThroughput,
    },
    passed,
    gaps: [
      "Distributed scheduler state, queueing, and circuit breaker coordination are not implemented.",
      "Semantic cache correctness is heuristic and needs larger adversarial evals before production use.",
      "Pricing remains configurable estimate data, not provider invoice reconciliation.",
      "Hosted multi-tenant auth, deployment, dashboards, and enterprise controls are intentionally out of scope for this local prototype.",
    ],
  };
}

export function formatReadinessMarkdown(report: ReadinessBenchmarkReport): string {
  return [
    "# TokenOps Product Readiness Proof",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Ready for local demo: ${report.summary.readyForLocalDemo}`,
    `- Replay datasets: ${report.summary.replayDatasets}`,
    `- Replay requests: ${report.summary.totalReplayRequests}`,
    `- Baseline cost: $${report.summary.baselineCostUsd}`,
    `- Optimized cost: $${report.summary.optimizedCostUsd}`,
    `- Estimated replay cost reduction: ${report.summary.estimatedReplayCostReductionPct}%`,
    `- Runtime avoided provider calls: ${report.summary.runtimeAvoidedProviderCalls}`,
    `- Micro-batching latency reduction: ${report.summary.batchingLatencyReductionPct}%`,
    `- Mock output tokens/sec: ${report.summary.mockOutputTokensPerSecond}`,
    `- Groq live measured: ${report.summary.groqLiveMeasured}`,
    "",
    "## Gates",
    "",
    ...Object.entries(report.passed).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Gaps",
    "",
    ...report.gaps.map((gap) => `- ${gap}`),
    "",
  ].join("\n");
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(6));
}

function roundPct(value: number): number {
  return Number(value.toFixed(1));
}
