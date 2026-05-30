import { describe, expect, it } from "vitest";
import {
  exportTokenOpsSnapshot,
  getTokenOpsIdempotencyRecord,
  importTokenOpsSnapshot,
  insertTokenOpsProviderAttempt,
  insertTokenOpsBenchmarkResult,
  insertTokenOpsIdempotencyRecord,
  insertTokenOpsTrace,
  listTokenOpsProviderAttempts,
  listTokenOpsBenchmarkResults,
  listTokenOpsTraces,
  openDb,
  pruneTokenOpsEvidence,
} from "./src/index.js";
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
    insertTokenOpsProviderAttempt(source, {
      id: "att_snapshot",
      trace_id: "tr_snapshot",
      request_hash: "tr_snapshot_hash",
      provider: "mock",
      model: "gpt-5-mini",
      ok: true,
      latency_ms: 3,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const snapshot = exportTokenOpsSnapshot(source);
    expect(snapshot.schema_version).toBe("tokenops.snapshot.v1");
    expect(snapshot.traces).toHaveLength(1);
    expect(snapshot.benchmark_results).toHaveLength(1);
    expect(snapshot.provider_attempts).toHaveLength(1);

    const target = openDb(":memory:");
    const imported = importTokenOpsSnapshot(target, snapshot);
    expect(imported).toEqual({ traces: 1, benchmark_results: 1, provider_attempts: 1 });
    expect(listTokenOpsTraces(target, { limit: 10 })[0]!.id).toBe("tr_snapshot");
    expect(listTokenOpsBenchmarkResults(target, 10)[0]!.dataset).toBe("snapshot.jsonl");
    expect(listTokenOpsProviderAttempts(target, { limit: 10 })[0]!.id).toBe("att_snapshot");
  });

  it("prunes old TokenOps evidence while keeping the newest records", () => {
    const db = openDb(":memory:");
    insertTokenOpsTrace(db, trace("tr_old"));
    insertTokenOpsTrace(db, trace("tr_new"));
    insertTokenOpsBenchmarkResult(db, "bm_old", benchmark("old.jsonl"));
    insertTokenOpsBenchmarkResult(db, "bm_new", benchmark("new.jsonl"));
    insertTokenOpsIdempotencyRecord(db, {
      route: "/v1/chat/completions",
      key: "old-key",
      request_hash: "old-hash",
      status_code: 200,
      response_body: { ok: true },
      created_at: "2026-01-01T00:00:00.000Z",
    });
    insertTokenOpsIdempotencyRecord(db, {
      route: "/v1/chat/completions",
      key: "new-key",
      request_hash: "new-hash",
      status_code: 200,
      response_body: { ok: true },
      created_at: "2026-01-02T00:00:00.000Z",
    });

    const pruned = pruneTokenOpsEvidence(db, {
      keepLatestTraces: 1,
      keepLatestBenchmarkResults: 1,
      keepLatestIdempotencyRecords: 1,
    });

    expect(pruned).toEqual({ traces: 1, benchmark_results: 1, idempotency_records: 1 });
    expect(listTokenOpsTraces(db, { limit: 10 }).map((row) => row.id)).toEqual(["tr_new"]);
    expect(listTokenOpsBenchmarkResults(db, 10).map((row) => row.dataset)).toEqual(["new.jsonl"]);
    expect(getTokenOpsIdempotencyRecord(db, "/v1/chat/completions", "old-key")).toBeNull();
    expect(getTokenOpsIdempotencyRecord(db, "/v1/chat/completions", "new-key")).toBeTruthy();
  });

  it("stores and lists provider attempts for gateway requests", () => {
    const db = openDb(":memory:");
    insertTokenOpsProviderAttempt(db, {
      id: "att_1",
      trace_id: "tr_1",
      request_hash: "hash_1",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      ok: false,
      error: "upstream unavailable",
      latency_ms: 25,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const attempts = listTokenOpsProviderAttempts(db, { limit: 10 });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ provider: "groq", ok: false, error: "upstream unavailable" });
  });
});
