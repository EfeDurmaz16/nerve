import { describe, expect, it } from "vitest";
import { exportTokenOpsSnapshot, importTokenOpsSnapshot, insertTokenOpsBenchmarkResult, insertTokenOpsTrace, listTokenOpsBenchmarkResults, listTokenOpsTraces, openDb } from "./src/index.js";
import type { BenchmarkResult, RequestTrace } from "@tokenops/core";

const trace = (id = "tr_export"): RequestTrace => ({
  id,
  timestamp: new Date().toISOString(),
  workloadType: "docs_qa",
  requestedModel: "gpt-5.5",
  selectedModel: "gpt-5-mini",
  selectedProvider: "mock",
  inputTokensEstimated: 120,
  outputTokensEstimated: 24,
  cache: { exactHit: true, semanticHit: false, toolResultHit: false, contextBlockHit: true, prefixCacheEligibleTokens: 100 },
  routing: { selectedProvider: "mock", selectedModel: "gpt-5-mini", originalRequestedModel: "gpt-5.5", downgraded: true, escalated: false, reason: "fixture" },
  policy: { allowed: true, reason: "fixture" },
  cost: { estimatedBaselineCost: 0.02, estimatedOptimizedCost: 0, estimatedSavings: 0.02 },
  normalizedHash: `${id}_hash`,
  finalResponseSource: "exact_cache",
});

const benchmark = (dataset = "docs-qa.jsonl"): BenchmarkResult => ({
  dataset,
  total_requests: 2,
  baseline_cost: 0.02,
  optimized_cost: 0.005,
  estimated_savings: 0.015,
  exact_cache_hit_rate: 0.5,
  semantic_cache_hit_rate: 0,
  tool_result_reuse_rate: 0,
  model_downgrade_rate: 0.5,
  verifier_escalation_rate: 0,
  p50_latency_estimate: 20,
  p95_latency_estimate: 40,
  wrong_cache_incidents: 0,
});

describe("TokenOps store snapshots", () => {
  it("exports and imports traces plus benchmark results", () => {
    const source = openDb(":memory:");
    insertTokenOpsTrace(source, trace("tr_snapshot"));
    insertTokenOpsBenchmarkResult(source, "bm_snapshot", benchmark("snapshot.jsonl"));

    const snapshot = exportTokenOpsSnapshot(source);
    expect(snapshot.schema_version).toBe("tokenops.snapshot.v1");
    expect(snapshot.traces).toHaveLength(1);
    expect(snapshot.benchmark_results).toHaveLength(1);

    const target = openDb(":memory:");
    const imported = importTokenOpsSnapshot(target, snapshot);
    expect(imported).toEqual({ traces: 1, benchmark_results: 1 });
    expect(listTokenOpsTraces(target, { limit: 10 })[0]!.id).toBe("tr_snapshot");
    expect(listTokenOpsBenchmarkResults(target, 10)[0]!.dataset).toBe("snapshot.jsonl");
  });
});
