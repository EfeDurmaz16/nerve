import { describe, expect, it } from "vitest";
import type { RequestTrace } from "@tokenops/core";
import { analyzeTraces, gatewayStats, providerHealthReport, reconcileModelResponseCost, reconcileProviderUsage, SqliteTraceStore, TraceStore } from "./src/index.js";
import { openDb } from "@nerve/store";

const trace = (over: Partial<RequestTrace> = {}): RequestTrace => ({
  id: "tr_1",
  timestamp: new Date().toISOString(),
  workloadType: "docs_qa",
  requestedModel: "gpt-5.5",
  selectedModel: "gpt-5-mini",
  selectedProvider: "mock",
  inputTokensEstimated: 1000,
  cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 1200 },
  routing: { selectedProvider: "mock", selectedModel: "gpt-5-mini", originalRequestedModel: "gpt-5.5", downgraded: true, escalated: false, reason: "safe docs qa" },
  policy: { allowed: true, reason: "ok" },
  cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: 0.2, estimatedSavings: 0.8 },
  normalizedHash: "abc",
  finalResponseSource: "model",
  ...over,
});

describe("TokenOps ledger", () => {
  it("stores and lists request traces", () => {
    const store = new TraceStore();
    store.insert(trace());
    expect(store.get("tr_1")?.selectedModel).toBe("gpt-5-mini");
    expect(gatewayStats(store.list()).cost.estimatedSavings).toBe(0.8);
  });

  it("redacts provider and metadata secrets before storing traces", () => {
    const store = new TraceStore();
    store.insert(trace({
      id: "tr_secret",
      routing: {
        selectedProvider: "groq",
        selectedModel: "llama-3.3-70b-versatile",
        originalRequestedModel: "gpt-5.5",
        downgraded: true,
        escalated: false,
        reason: "failed with Bearer abc.def and gsk_secret_value and sk-test-secret",
      },
      policy: { allowed: false, reason: "authorization=Bearer abc.def api_key=gsk_secret_value" },
    }));
    const stored = JSON.stringify(store.get("tr_secret"));
    expect(stored).not.toContain("gsk_secret_value");
    expect(stored).not.toContain("sk-test-secret");
    expect(stored).not.toContain("Bearer abc.def");
    expect(stored).toContain("gsk_[REDACTED]");
  });

  it("produces cheaper insights", () => {
    const insights = analyzeTraces([trace()]);
    expect(insights.some((i) => i.kind === "overkill_model")).toBe(true);
    expect(insights.some((i) => i.kind === "prefix_cache")).toBe(true);
  });

  it("persists request traces in sqlite", () => {
    const store = new SqliteTraceStore(openDb(":memory:"));
    store.insert(trace({ id: "tr_sqlite" }));
    expect(store.get("tr_sqlite")?.requestedModel).toBe("gpt-5.5");
    expect(store.list().length).toBe(1);
  });

  it("reconciles model response usage against local pricing", () => {
    const result = reconcileModelResponseCost({
      id: "r",
      model: "llama-3.3-70b-versatile",
      provider: "groq",
      content: "ok",
      finish_reason: "stop",
      input_tokens: 42,
      output_tokens: 4,
      latency_ms: 1,
      cost_usd: 0.000028,
    });
    expect(result.status).toBe("matched");
    expect(result.promptTokens).toBe(42);
  });

  it("reconciles provider usage records against stored request traces", () => {
    const report = reconcileProviderUsage([
      trace({ id: "tr_match", normalizedHash: "hash_match", selectedProvider: "groq", selectedModel: "llama-3.3-70b-versatile", cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: 0.000028, estimatedSavings: 0.999972 } }),
      trace({ id: "tr_drift", normalizedHash: "hash_drift", selectedProvider: "groq", selectedModel: "llama-3.3-70b-versatile", cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: 0.000028, estimatedSavings: 0.999972 } }),
    ], [
      { provider: "groq", model: "llama-3.3-70b-versatile", traceId: "tr_match", requestHash: "hash_match", inputTokens: 42, outputTokens: 4, actualCostUsd: 0.000028 },
      { provider: "groq", model: "llama-3.3-70b-versatile", traceId: "tr_drift", requestHash: "hash_drift", inputTokens: 42, outputTokens: 4, actualCostUsd: 0.001 },
      { provider: "groq", model: "llama-3.3-70b-versatile", traceId: "tr_missing", requestHash: "hash_missing", inputTokens: 1, outputTokens: 1, actualCostUsd: 0.1 },
    ], { toleranceUsd: 0.000001 });

    expect(report.totalUsageRecords).toBe(3);
    expect(report.matched).toBe(1);
    expect(report.drifted).toBe(1);
    expect(report.missingTrace).toBe(1);
    expect(report.actualCostUsd).toBeCloseTo(0.101028);
    expect(report.estimatedTraceCostUsd).toBeCloseTo(0.000056);
    expect(report.deltaUsd).toBeCloseTo(0.100972);
    expect(report.records.find((record) => record.traceId === "tr_missing")?.status).toBe("missing_trace");
  });

  it("scores provider health from traces", () => {
    const report = providerHealthReport([
      trace({ id: "ok", selectedProvider: "groq", policy: { allowed: true, reason: "ok" }, quality: { verifierUsed: true, verifierPassed: true }, cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: 0.1, estimatedSavings: 0.9 } }),
      trace({ id: "bad", selectedProvider: "groq", policy: { allowed: true, reason: "ok" }, quality: { verifierUsed: true, verifierPassed: false }, cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: 0.1, estimatedSavings: 0.9 } }),
      trace({ id: "mock", selectedProvider: "mock", providerLatencyMs: 12, policy: { allowed: true, reason: "ok" }, quality: { verifierUsed: true, verifierPassed: true }, cost: { estimatedBaselineCost: 1, estimatedOptimizedCost: 0, estimatedSavings: 1 } }),
    ]);
    expect(report.providers.groq.requests).toBe(2);
    expect(report.providers.groq.verifierPassRate).toBe(0.5);
    expect(report.providers.mock.p95LatencyMs).toBe(12);
    expect(report.providers.mock.healthScore).toBeGreaterThan(report.providers.groq.healthScore);
  });
});
