import { describe, expect, it } from "vitest";
import { replayDataset, runBatchBenchmark, runCheapThenVerifyBenchmark, runLoadBenchmark, runProviderFailoverBenchmark, runProviderSloBenchmark, runProviderThroughputBenchmark, runReadinessBenchmark, runSemanticCacheSafetyBenchmark, runSemanticCacheThresholdSweep } from "./src/index.js";

describe("TokenOps benchmark", () => {
  it("reports required replay metrics", async () => {
    const result = await replayDataset("benchmark/datasets/docs-qa.jsonl");
    expect(result.total_requests).toBeGreaterThan(0);
    expect(result).toHaveProperty("exact_cache_hit_rate");
    expect(result).toHaveProperty("semantic_cache_hit_rate");
    expect(result).toHaveProperty("model_downgrade_rate");
    expect(result.baseline_model_calls).toBe(result.total_requests);
    expect(result.optimized_model_calls).toBeLessThan(result.baseline_model_calls!);
    expect(result.estimated_input_tokens_saved).toBeGreaterThan(0);
  });

  it("reports context and tool reuse signals", async () => {
    const context = await replayDataset("benchmark/datasets/long-prefix.jsonl");
    const tool = await replayDataset("benchmark/datasets/tool-result-reuse.jsonl");
    expect(context.context_block_reuse_rate).toBeGreaterThan(0);
    expect(context.prefix_cache_eligible_tokens).toBeGreaterThan(0);
    expect(tool.tool_result_reuse_rate).toBeGreaterThan(0);
  });

  it("measures runtime coalescing under concurrent duplicate load", async () => {
    const result = await runLoadBenchmark({
      requests: 20,
      concurrency: 10,
      duplicateRatio: 0.8,
      providerLatencyMs: 5,
      maxConcurrentInference: 10,
    });
    expect(result.requests).toBe(20);
    expect(result.providerCalls).toBeLessThan(result.requests);
    expect(result.coalescedResponses).toBeGreaterThan(0);
    expect(result.avoidedProviderCalls).toBeGreaterThan(0);
    expect(result.runtime.coalescer.coalescedWaiters).toBe(result.coalescedResponses);
  });

  it("keeps runtime coalescing proof deterministic for small samples", async () => {
    const result = await runLoadBenchmark({
      requests: 10,
      concurrency: 4,
      duplicateRatio: 0.75,
      providerLatencyMs: 5,
      maxConcurrentInference: 4,
    });

    expect(result.providerCalls).toBeLessThan(result.requests);
    expect(result.avoidedProviderCalls).toBeGreaterThan(0);
  });

  it("measures micro-batching throughput gains", async () => {
    const result = await runBatchBenchmark({
      requests: 16,
      batchSize: 4,
      batchWindowMs: 1,
      perBatchOverheadMs: 8,
      perItemLatencyMs: 1,
    });
    expect(result.batches).toBe(4);
    expect(result.largestBatch).toBe(4);
    expect(result.batchedWallTimeMs).toBeLessThan(result.baselineWallTimeMs);
    expect(result.estimatedLatencyReduction).toBeGreaterThan(0);
  });

  it("measures provider throughput with token rate metrics", async () => {
    const result = await runProviderThroughputBenchmark({
      provider: "mock",
      requests: 12,
      concurrency: 4,
      providerLatencyMs: 2,
    });
    expect(result.skipped).toBe(false);
    expect(result.requests).toBe(12);
    expect(result.providerCalls).toBe(12);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.outputTokensPerSecond).toBeGreaterThan(0);
    expect(result.p95LatencyMs).toBeGreaterThanOrEqual(result.p50LatencyMs);
  });

  it("skips unavailable Ollama throughput checks with an actionable report", async () => {
    const result = await runProviderThroughputBenchmark({
      provider: "ollama",
      requests: 1,
      concurrency: 1,
      baseUrl: "http://127.0.0.1:9",
      availabilityTimeoutMs: 25,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("Ollama");
    expect(result.expectedCommand).toContain("ollama serve");
  });

  it("skips Groq throughput checks when no API key is configured", async () => {
    const result = await runProviderThroughputBenchmark({
      provider: "groq",
      apiKey: "",
      requests: 1,
      concurrency: 1,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("GROQ_API_KEY");
    expect(result.expectedCommand).toContain("GROQ_API_KEY");
  });

  it("measures semantic cache safety against adversarial cache-reuse cases", async () => {
    const result = await runSemanticCacheSafetyBenchmark("benchmark/evals/semantic-cache-safety.jsonl");
    expect(result.totalCases).toBeGreaterThan(0);
    expect(result.safeReuseAttempts).toBeGreaterThan(0);
    expect(result.safeReuseHits).toBe(result.safeReuseAttempts);
    expect(result.riskyReuseAttempts).toBeGreaterThan(0);
    expect(result.riskyReuseBlocked).toBe(result.riskyReuseAttempts);
    expect(result.falsePositiveUnsafeHits).toBe(0);
    expect(result.passed).toBe(true);
  });

  it("sweeps semantic cache thresholds and recommends a safe threshold", async () => {
    const result = await runSemanticCacheThresholdSweep("benchmark/evals/semantic-cache-safety.jsonl", [0.2, 0.3, 0.5]);

    expect(result.thresholds).toHaveLength(3);
    expect(result.recommendedThreshold).toBeGreaterThanOrEqual(0.2);
    expect(result.recommendedThreshold).toBeLessThanOrEqual(0.5);
    expect(result.recommended?.falsePositiveUnsafeHits).toBe(0);
    expect(result.recommended?.passed).toBe(true);
  });

  it("measures runtime circuit-breaker failover to fallback providers", async () => {
    const result = await runProviderFailoverBenchmark({
      requests: 8,
      primaryFailuresBeforeSuccess: 8,
      circuitFailureThreshold: 2,
      fallbackLatencyMs: 1,
    });
    expect(result.requests).toBe(8);
    expect(result.primaryProviderCalls).toBe(2);
    expect(result.circuitOpened).toBe(true);
    expect(result.circuitRejectedRequests).toBeGreaterThan(0);
    expect(result.fallbackProviderCalls).toBe(8);
    expect(result.successfulResponses).toBe(8);
    expect(result.failedResponses).toBe(0);
  });

  it("measures cheap-then-verify routing over regression cases", async () => {
    const result = await runCheapThenVerifyBenchmark("benchmark/evals/cheap-then-verify.jsonl");
    expect(result.totalCases).toBeGreaterThan(0);
    expect(result.expectedEscalations).toBeGreaterThan(0);
    expect(result.actualEscalations).toBe(result.expectedEscalations);
    expect(result.falseEscalations).toBe(0);
    expect(result.missedEscalations).toBe(0);
    expect(result.passed).toBe(true);
  });

  it("measures provider SLO routing away from unhealthy providers", () => {
    const result = runProviderSloBenchmark();
    expect(result.originalProvider).toBe("groq");
    expect(result.selectedProvider).toBe("mock");
    expect(result.unhealthyProviderEligible).toBe(false);
    expect(result.fallbackProviderEligible).toBe(true);
    expect(result.rerouted).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("summarizes product readiness evidence across replay, runtime, and provider benchmarks", async () => {
    const report = await runReadinessBenchmark({
      loadRequests: 12,
      loadConcurrency: 6,
      batchRequests: 12,
      throughputRequests: 6,
      throughputConcurrency: 3,
      includeGroq: false,
    });
    expect(report.summary.readyForLocalDemo).toBe(true);
    expect(report.summary.totalReplayRequests).toBeGreaterThan(0);
    expect(report.summary.estimatedReplayCostReductionPct).toBeGreaterThan(0);
    expect(report.evidence.runtimeCoalescing.avoidedProviderCalls).toBeGreaterThan(0);
    expect(report.evidence.microBatching.estimatedLatencyReduction).toBeGreaterThan(0);
    expect(report.evidence.providerFailover.circuitOpened).toBe(true);
    expect(report.evidence.providerFailover.fallbackProviderCalls).toBe(report.evidence.providerFailover.requests);
    expect(report.evidence.providerFailover.failedResponses).toBe(0);
    expect(report.passed.runtimeCircuitBreakerFallsBackAfterPrimaryFailures).toBe(true);
    expect(report.evidence.mockThroughput.outputTokensPerSecond).toBeGreaterThan(0);
    expect(report.evidence.adaptiveRouting.baseRoute.selectedModel).toBe("gpt-5.5");
    expect(report.evidence.adaptiveRouting.learnedRoute.selectedModel).toBe("gpt-5-mini");
    expect(report.passed.adaptiveRoutingDowngradesFromTraceEvidence).toBe(true);
    expect(report.evidence.providerSlo.rerouted).toBe(true);
    expect(report.evidence.providerSlo.selectedProvider).toBe("mock");
    expect(report.passed.providerSloRoutingAvoidsUnhealthyProviders).toBe(true);
    expect(report.evidence.providerFallback.selectedProvider).toBe("mock");
    expect(report.evidence.providerFallback.failedProviders).toEqual(["groq"]);
    expect(report.passed.providerFallbackSurvivesPrimaryFailure).toBe(true);
    expect(report.evidence.verifierGate.passCase.escalatedAfterFail).toBe(false);
    expect(report.evidence.verifierGate.failCase.escalatedAfterFail).toBe(true);
    expect(report.evidence.verifierGate.failCase.finalProvider).toBe("strong");
    expect(report.passed.verifierGateEscalatesFailedCheapAnswer).toBe(true);
    expect(report.evidence.verifierRouting.expectedEscalations).toBeGreaterThan(0);
    expect(report.evidence.verifierRouting.actualEscalations).toBe(report.evidence.verifierRouting.expectedEscalations);
    expect(report.evidence.verifierRouting.missedEscalations).toBe(0);
    expect(report.passed.verifierRoutingEvalPasses).toBe(true);
    expect(report.evidence.policyControls.budget.action).toBe("block");
    expect(report.evidence.policyControls.loop.action).toBe("block");
    expect(report.passed.policyControlsBlockWastefulCompute).toBe(true);
    expect(report.evidence.cacheSafety.safeDocsCacheability).toBe("semantic_safe");
    expect(report.evidence.cacheSafety.riskyPrivateCacheability).toBe("never_cache");
    expect(report.passed.semanticCacheSafetyBlocksRiskyPrivateWorkloads).toBe(true);
    expect(report.evidence.semanticSafety.totalCases).toBeGreaterThan(0);
    expect(report.evidence.semanticSafety.falsePositiveUnsafeHits).toBe(0);
    expect(report.evidence.semanticSafety.falseNegativeSafeMisses).toBe(0);
    expect(report.passed.semanticCacheAdversarialEvalPasses).toBe(true);
    expect(report.evidence.semanticThresholdSweep.recommendedThreshold).not.toBeNull();
    expect(report.passed.semanticThresholdSweepFindsSafeThreshold).toBe(true);
    expect(report.evidence.cheaperAnalyzer.insightCount).toBeGreaterThanOrEqual(2);
    expect(report.evidence.cheaperAnalyzer.kinds).toContain("overkill_model");
    expect(report.evidence.cheaperAnalyzer.kinds).toContain("prefix_cache");
    expect(report.passed.cheaperAnalyzerFindsAvoidableCompute).toBe(true);
    expect(report.evidence.gatewayCompatibility.object).toBe("chat.completion");
    expect(report.evidence.gatewayCompatibility.hasUsage).toBe(true);
    expect(report.evidence.gatewayCompatibility.hasTokenOpsMetadata).toBe(true);
    expect(report.evidence.gatewayCompatibility.responsesObject).toBe("response");
    expect(report.evidence.gatewayCompatibility.responsesHasOutputText).toBe(true);
    expect(report.evidence.gatewayCompatibility.embeddingsObject).toBe("list");
    expect(report.evidence.gatewayCompatibility.embeddingsCount).toBe(2);
    expect(report.evidence.gatewayCompatibility.embeddingsVectorDimensions).toBeGreaterThan(0);
    expect(report.passed.openAICompatibleGatewayShape).toBe(true);
    expect(report.evidence.traceLedger.storedTraceCount).toBe(2);
    expect(report.evidence.traceLedger.estimatedSavings).toBeGreaterThan(0);
    expect(report.evidence.traceLedger.exactCacheHitRate).toBeGreaterThan(0);
    expect(report.passed.traceLedgerRecordsCostAndCacheEvidence).toBe(true);
    expect(report.evidence.providerUsageReconciliation.totalUsageRecords).toBeGreaterThan(0);
    expect(report.evidence.providerUsageReconciliation.drifted).toBeGreaterThan(0);
    expect(report.passed.providerUsageReconciliationDetectsBillingDrift).toBe(true);
    expect(report.evidence.aisPlanner.exactCachePlan.foregroundAction).toBe("serve_exact_cache");
    expect(report.evidence.aisPlanner.semanticCachePlan.foregroundAction).toBe("serve_semantic_cache");
    expect(report.evidence.aisPlanner.semanticCachePlan.backgroundTasks).toContain("verify_cached_answer");
    expect(report.evidence.aisPlanner.budgetBlockPlan.foregroundAction).toBe("block_budget");
    expect(report.evidence.aisPlanner.repeatedContextPlan.contextStrategy.dedupeRepeatedContext).toBe(true);
    expect(report.evidence.aisPlanner.repeatedContextPlan.backgroundTasks).toContain("compress_trace");
    expect(report.passed.aisPlannerChoosesForegroundAndBackgroundActions).toBe(true);
    expect(report.gaps.length).toBeGreaterThan(0);
  });
});
