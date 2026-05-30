import { planCompute } from "@tokenops/ais";
import type { BenchmarkResult, ComputePlan, ModelResponse, NormalizedRequest } from "@tokenops/core";
import type { RequestTrace } from "@tokenops/core";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { toOpenAIChatCompletion, toOpenAIEmbeddingResponse, toOpenAIResponse } from "@tokenops/gateway";
import { analyzeTraces, gatewayStats, providerHealthReport, reconcileProviderUsage, TraceStore, type CheaperInsight, type ProviderUsageReconciliationReport } from "@tokenops/ledger";
import { detectAgentLoop, evaluateBudgetPolicy, type LoopSignal, type PolicyDecision } from "@tokenops/policy";
import { classifyCacheability } from "@tokenops/profiler";
import { FallbackProvider, MockProvider, type ModelProvider } from "@tokenops/providers";
import { applyLearnedRouting, applyProviderArbitrage, learnRoutingPolicy, type ModelRoute } from "@tokenops/router";
import { cheapThenVerify } from "@tokenops/verifier";
import { replayAll } from "./replay-runner.js";
import { runBatchBenchmark, type BatchBenchmarkResult } from "./batch-runner.js";
import { runProviderFailoverBenchmark, type ProviderFailoverBenchmarkResult } from "./failover-runner.js";
import { runLoadBenchmark, type LoadBenchmarkResult } from "./load-runner.js";
import { runProviderSloBenchmark, type ProviderSloBenchmarkResult } from "./provider-slo-runner.js";
import { runProviderThroughputBenchmark, type ProviderThroughputResult } from "./provider-throughput-runner.js";
import { runPrioritySchedulingBenchmark, type PrioritySchedulingBenchmarkResult } from "./priority-scheduling-runner.js";
import { runSemanticCacheSafetyBenchmark, runSemanticCacheThresholdSweep, type SemanticSafetyBenchmarkResult, type SemanticThresholdSweepResult } from "./semantic-safety-runner.js";
import { runCheapThenVerifyBenchmark, type CheapThenVerifyBenchmarkResult } from "./verifier-routing-runner.js";

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
    priorityScheduling: PrioritySchedulingBenchmarkResult;
    providerFailover: ProviderFailoverBenchmarkResult;
    mockThroughput: ProviderThroughputResult;
    adaptiveRouting: AdaptiveRoutingProof;
    providerSlo: ProviderSloBenchmarkResult;
    providerFallback: ProviderFallbackProof;
    providerArbitrage: ProviderArbitrageProof;
    verifierGate: VerifierGateProof;
    verifierRouting: CheapThenVerifyBenchmarkResult;
    policyControls: PolicyControlsProof;
    cacheSafety: CacheSafetyProof;
    semanticSafety: SemanticSafetyBenchmarkResult;
    semanticThresholdSweep: SemanticThresholdSweepResult;
    cheaperAnalyzer: CheaperAnalyzerProof;
    gatewayCompatibility: GatewayCompatibilityProof;
    traceLedger: TraceLedgerProof;
    providerUsageReconciliation: ProviderUsageReconciliationReport;
    aisPlanner: AISPlannerProof;
    groqThroughput?: ProviderThroughputResult;
  };
  passed: Record<string, boolean>;
  gaps: string[];
}

export interface AdaptiveRoutingProof {
  historicalTraceCount: number;
  learnedRules: number;
  baseRoute: ModelRoute;
  learnedRoute: ModelRoute;
  estimatedAvoidedCostUsd: number;
  reason: string;
}

export interface ProviderFallbackProof {
  selectedProvider: string;
  failedProviders: string[];
  attempts: Array<{ provider: string; ok: boolean }>;
  content: string;
  reason: string;
}

export interface ProviderArbitrageProof {
  originalProvider: string;
  selectedProvider: string;
  candidates: string[];
  originalAverageCostUsd: number;
  selectedAverageCostUsd: number;
  selectedP95LatencyMs: number;
  selectedHealthScore: number;
  route: ModelRoute;
  reason: string;
}

export interface VerifierGateProof {
  passCase: {
    verifierPassed: boolean;
    escalatedAfterFail: boolean;
    finalProvider: string;
    finalContent: string;
  };
  failCase: {
    verifierPassed: boolean;
    escalatedAfterFail: boolean;
    finalProvider: string;
    finalContent: string;
  };
  reason: string;
}

export interface PolicyControlsProof {
  budget: PolicyDecision;
  loop: LoopSignal;
  repeatedTraceCount: number;
  reason: string;
}

export interface CacheSafetyProof {
  safeDocsCacheability: string;
  riskyPrivateCacheability: string;
  safePrompt: string;
  riskyPrompt: string;
  reason: string;
}

export interface CheaperAnalyzerProof {
  insightCount: number;
  kinds: CheaperInsight["kind"][];
  estimatedAvoidableCostUsd: number;
  messages: string[];
  reason: string;
}

export interface GatewayCompatibilityProof {
  object: string;
  model: string;
  hasChoices: boolean;
  hasUsage: boolean;
  hasTokenOpsMetadata: boolean;
  responsesObject: string;
  responsesHasOutputText: boolean;
  responsesHasOutput: boolean;
  embeddingsObject: string;
  embeddingsCount: number;
  embeddingsVectorDimensions: number;
  promptTokens: number;
  completionTokens: number;
  reason: string;
}

export interface TraceLedgerProof {
  storedTraceCount: number;
  exactCacheHitRate: number;
  modelDowngradeRate: number;
  estimatedBaselineCost: number;
  estimatedOptimizedCost: number;
  estimatedSavings: number;
  reason: string;
}

export interface AISPlannerProof {
  exactCachePlan: ComputePlan;
  semanticCachePlan: ComputePlan;
  budgetBlockPlan: ComputePlan;
  repeatedContextPlan: ComputePlan;
  reason: string;
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
  const priorityScheduling = await runPrioritySchedulingBenchmark();
  const providerFailover = await runProviderFailoverBenchmark({
    requests: 8,
    primaryFailuresBeforeSuccess: 8,
    circuitFailureThreshold: 2,
    fallbackLatencyMs: 1,
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
  const adaptiveRouting = buildAdaptiveRoutingProof();
  const providerSlo = runProviderSloBenchmark();
  const providerFallback = await buildProviderFallbackProof();
  const providerArbitrage = buildProviderArbitrageProof();
  const verifierGate = await buildVerifierGateProof();
  const verifierRouting = await runCheapThenVerifyBenchmark("benchmark/evals/cheap-then-verify.jsonl");
  const policyControls = buildPolicyControlsProof();
  const cacheSafety = buildCacheSafetyProof();
  const semanticSafety = await runSemanticCacheSafetyBenchmark("benchmark/evals/semantic-cache-safety.jsonl");
  const semanticThresholdSweep = await runSemanticCacheThresholdSweep("benchmark/evals/semantic-cache-safety.jsonl");
  const cheaperAnalyzer = buildCheaperAnalyzerProof();
  const gatewayCompatibility = buildGatewayCompatibilityProof();
  const traceLedger = buildTraceLedgerProof();
  const providerUsageReconciliation = buildProviderUsageReconciliationProof();
  const aisPlanner = buildAISPlannerProof();

  const baselineCostUsd = sum(replay.map((r) => r.baseline_cost));
  const optimizedCostUsd = sum(replay.map((r) => r.optimized_cost));
  const estimatedReplayCostReductionPct = baselineCostUsd === 0 ? 0 : ((baselineCostUsd - optimizedCostUsd) / baselineCostUsd) * 100;
  const passed = {
    replayShowsSavings: replay.length > 0 && estimatedReplayCostReductionPct > 0,
    exactOrSemanticCacheObserved: replay.some((r) => r.exact_cache_hit_rate > 0 || r.semantic_cache_hit_rate > 0),
    toolOrContextReuseObserved: replay.some((r) => r.tool_result_reuse_rate > 0 || (r.context_block_reuse_rate ?? 0) > 0),
    runtimeCoalescingAvoidsCalls: runtimeCoalescing.avoidedProviderCalls > 0,
    microBatchingReducesLatency: microBatching.estimatedLatencyReduction > 0,
    prioritySchedulingProtectsForegroundInference: priorityScheduling.passed && priorityScheduling.foregroundStartedBeforeBackground,
    runtimeCircuitBreakerFallsBackAfterPrimaryFailures:
      providerFailover.circuitOpened &&
      providerFailover.primaryProviderCalls === providerFailover.circuitFailureThreshold &&
      providerFailover.fallbackProviderCalls === providerFailover.requests &&
      providerFailover.failedResponses === 0,
    mockThroughputMeasured: !mockThroughput.skipped && mockThroughput.outputTokensPerSecond > 0,
    adaptiveRoutingDowngradesFromTraceEvidence: adaptiveRouting.baseRoute.selectedModel !== adaptiveRouting.learnedRoute.selectedModel && adaptiveRouting.learnedRoute.selectedModel === "gpt-5-mini",
    providerSloRoutingAvoidsUnhealthyProviders: providerSlo.passed && providerSlo.rerouted && providerSlo.selectedProvider === "mock",
    providerFallbackSurvivesPrimaryFailure: providerFallback.selectedProvider === "mock" && providerFallback.failedProviders.includes("groq"),
    providerArbitrageChoosesCheapestHealthyProvider:
      providerArbitrage.originalProvider !== providerArbitrage.selectedProvider &&
      providerArbitrage.selectedProvider === "groq" &&
      providerArbitrage.selectedAverageCostUsd < providerArbitrage.originalAverageCostUsd &&
      providerArbitrage.selectedHealthScore >= 0.8,
    verifierGateEscalatesFailedCheapAnswer: verifierGate.passCase.escalatedAfterFail === false && verifierGate.failCase.escalatedAfterFail === true && verifierGate.failCase.finalProvider === "strong",
    verifierRoutingEvalPasses: verifierRouting.passed && verifierRouting.expectedEscalations > 0 && verifierRouting.missedEscalations === 0,
    policyControlsBlockWastefulCompute: policyControls.budget.action === "block" && policyControls.loop.action === "block",
    semanticCacheSafetyBlocksRiskyPrivateWorkloads: cacheSafety.safeDocsCacheability === "semantic_safe" && cacheSafety.riskyPrivateCacheability === "never_cache",
    semanticCacheAdversarialEvalPasses: semanticSafety.passed && semanticSafety.falsePositiveUnsafeHits === 0 && semanticSafety.falseNegativeSafeMisses === 0,
    semanticThresholdSweepFindsSafeThreshold: Boolean(semanticThresholdSweep.recommended && semanticThresholdSweep.recommended.falsePositiveUnsafeHits === 0),
    cheaperAnalyzerFindsAvoidableCompute: cheaperAnalyzer.kinds.includes("overkill_model") && cheaperAnalyzer.kinds.includes("prefix_cache"),
    openAICompatibleGatewayShape:
      gatewayCompatibility.object === "chat.completion" &&
      gatewayCompatibility.hasChoices &&
      gatewayCompatibility.hasUsage &&
      gatewayCompatibility.hasTokenOpsMetadata &&
      gatewayCompatibility.responsesObject === "response" &&
      gatewayCompatibility.responsesHasOutputText &&
      gatewayCompatibility.responsesHasOutput &&
      gatewayCompatibility.embeddingsObject === "list" &&
      gatewayCompatibility.embeddingsCount > 0 &&
      gatewayCompatibility.embeddingsVectorDimensions > 0,
    traceLedgerRecordsCostAndCacheEvidence: traceLedger.storedTraceCount === 2 && traceLedger.exactCacheHitRate > 0 && traceLedger.estimatedSavings > 0,
    providerUsageReconciliationDetectsBillingDrift: providerUsageReconciliation.totalUsageRecords > 0 && providerUsageReconciliation.drifted > 0 && providerUsageReconciliation.deltaUsd > 0,
    aisPlannerChoosesForegroundAndBackgroundActions:
      aisPlanner.exactCachePlan.foregroundAction === "serve_exact_cache" &&
      aisPlanner.semanticCachePlan.foregroundAction === "serve_semantic_cache" &&
      aisPlanner.semanticCachePlan.backgroundTasks.includes("verify_cached_answer") &&
      aisPlanner.budgetBlockPlan.foregroundAction === "block_budget" &&
      aisPlanner.repeatedContextPlan.contextStrategy.dedupeRepeatedContext &&
      aisPlanner.repeatedContextPlan.backgroundTasks.includes("compress_trace"),
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
      priorityScheduling,
      providerFailover,
      mockThroughput,
      adaptiveRouting,
      providerSlo,
      providerFallback,
      providerArbitrage,
      verifierGate,
      verifierRouting,
      policyControls,
      cacheSafety,
      semanticSafety,
      semanticThresholdSweep,
      cheaperAnalyzer,
      gatewayCompatibility,
      traceLedger,
      providerUsageReconciliation,
      aisPlanner,
      groqThroughput,
    },
    passed,
    gaps: [
      "Distributed scheduler state, queueing, and circuit breaker coordination are not implemented.",
      "Semantic cache correctness is heuristic; threshold sweep exists, but the adversarial corpus still needs production-scale expansion.",
      "Provider usage reconciliation supports JSONL ingestion; direct provider invoice API ingestion is not implemented.",
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
    `- Priority scheduling: ${report.evidence.priorityScheduling.executionOrder.join(" -> ")}`,
    `- Provider failover: circuit=${report.evidence.providerFailover.circuitOpened}, fallback calls=${report.evidence.providerFailover.fallbackProviderCalls}, failed=${report.evidence.providerFailover.failedResponses}`,
    `- Mock output tokens/sec: ${report.summary.mockOutputTokensPerSecond}`,
    `- Groq live measured: ${report.summary.groqLiveMeasured}`,
    `- Adaptive routing route: ${report.evidence.adaptiveRouting.baseRoute.selectedModel} -> ${report.evidence.adaptiveRouting.learnedRoute.selectedModel}`,
    `- Adaptive routing avoided cost/request: $${report.evidence.adaptiveRouting.estimatedAvoidedCostUsd}`,
    `- Provider SLO routing: ${report.evidence.providerSlo.originalProvider} -> ${report.evidence.providerSlo.selectedProvider}, p95=${report.evidence.providerSlo.unhealthyProviderP95LatencyMs}ms`,
    `- Provider fallback route: ${report.evidence.providerFallback.failedProviders.join(",") || "none"} -> ${report.evidence.providerFallback.selectedProvider}`,
    `- Provider arbitrage route: ${report.evidence.providerArbitrage.originalProvider} -> ${report.evidence.providerArbitrage.selectedProvider}, avg_cost=$${report.evidence.providerArbitrage.selectedAverageCostUsd}, health=${report.evidence.providerArbitrage.selectedHealthScore}`,
    `- Verifier gate escalation: ${report.evidence.verifierGate.passCase.finalProvider} pass, ${report.evidence.verifierGate.failCase.finalProvider} after fail`,
    `- Verifier routing eval: ${report.evidence.verifierRouting.actualEscalations}/${report.evidence.verifierRouting.expectedEscalations} expected escalations, missed=${report.evidence.verifierRouting.missedEscalations}`,
    `- Policy controls: budget ${report.evidence.policyControls.budget.action}, loop ${report.evidence.policyControls.loop.action}`,
    `- Cache safety: docs ${report.evidence.cacheSafety.safeDocsCacheability}, risky ${report.evidence.cacheSafety.riskyPrivateCacheability}`,
    `- Semantic safety eval: ${report.evidence.semanticSafety.totalCases} cases, unsafe hits=${report.evidence.semanticSafety.falsePositiveUnsafeHits}, safe misses=${report.evidence.semanticSafety.falseNegativeSafeMisses}`,
    `- Semantic threshold sweep: recommended=${report.evidence.semanticThresholdSweep.recommendedThreshold}, thresholds=${report.evidence.semanticThresholdSweep.thresholds.length}`,
    `- Cheaper analyzer: ${report.evidence.cheaperAnalyzer.insightCount} insights, $${report.evidence.cheaperAnalyzer.estimatedAvoidableCostUsd} avoidable`,
    `- Gateway compatibility: ${report.evidence.gatewayCompatibility.object} + ${report.evidence.gatewayCompatibility.responsesObject} + embeddings(${report.evidence.gatewayCompatibility.embeddingsVectorDimensions}d), usage=${report.evidence.gatewayCompatibility.hasUsage}, tokenops=${report.evidence.gatewayCompatibility.hasTokenOpsMetadata}`,
    `- Trace ledger: ${report.evidence.traceLedger.storedTraceCount} traces, savings=$${report.evidence.traceLedger.estimatedSavings}`,
    `- Provider usage reconciliation: records=${report.evidence.providerUsageReconciliation.totalUsageRecords}, drift=${report.evidence.providerUsageReconciliation.drifted}, delta=$${report.evidence.providerUsageReconciliation.deltaUsd}`,
    `- AIS planner: exact=${report.evidence.aisPlanner.exactCachePlan.foregroundAction}, semantic=${report.evidence.aisPlanner.semanticCachePlan.foregroundAction}, budget=${report.evidence.aisPlanner.budgetBlockPlan.foregroundAction}`,
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

function buildTraceLedgerProof(): TraceLedgerProof {
  const store = new TraceStore();
  store.insert(routingTrace("ledger_model_call", 0.002, "gpt-5-mini"));
  store.insert({
    ...routingTrace("ledger_exact_hit", 0, "gpt-5-mini"),
    cache: { exactHit: true, semanticHit: false, toolResultHit: false, contextBlockHit: true, prefixCacheEligibleTokens: 0 },
    cost: { estimatedBaselineCost: 0.01, estimatedOptimizedCost: 0, estimatedSavings: 0.01 },
    finalResponseSource: "exact_cache",
  });
  const traces = store.list(10);
  const stats = gatewayStats(traces);
  return {
    storedTraceCount: traces.length,
    exactCacheHitRate: stats.exact_cache_hit_rate,
    modelDowngradeRate: stats.model_downgrade_rate,
    estimatedBaselineCost: roundMoney(stats.cost.baselineCost),
    estimatedOptimizedCost: roundMoney(stats.cost.optimizedCost),
    estimatedSavings: roundMoney(stats.cost.estimatedSavings),
    reason: "trace ledger stores request decisions and cost ledger summarizes cache/routing savings",
  };
}

function buildProviderUsageReconciliationProof(): ProviderUsageReconciliationReport {
  const trace = routingTrace("invoice_reconcile_trace", 0.000028, "llama-3.3-70b-versatile");
  return reconcileProviderUsage([{
    ...trace,
    selectedProvider: "groq",
    selectedModel: "llama-3.3-70b-versatile",
    normalizedHash: "invoice_reconcile_hash",
    cost: { estimatedBaselineCost: 0.01, estimatedOptimizedCost: 0.000028, estimatedSavings: 0.009972 },
  }], [
    {
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      traceId: "invoice_reconcile_trace",
      requestHash: "invoice_reconcile_hash",
      inputTokens: 42,
      outputTokens: 4,
      actualCostUsd: 0.001,
      invoiceId: "synthetic-readiness-invoice",
    },
  ]);
}

function buildAISPlannerProof(): AISPlannerProof {
  const request = normalizeChatCompletionRequest({
    model: "gpt-5.5",
    messages: [
      { role: "system", content: "You are answering stable TokenOps documentation questions." },
      { role: "user", content: "Explain how the adaptive inference control plane chooses cache vs model calls." },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "docs_retrieve",
          description: "Retrieve stable documentation blocks by query.",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      },
    ],
  }, { provider: "groq", workloadType: "docs_qa", riskLevel: "low" });
  const route: ModelRoute = {
    selectedProvider: "groq",
    selectedModel: "gpt-5-mini",
    originalRequestedModel: "gpt-5.5",
    downgraded: true,
    escalated: false,
    fallback: "mock",
    reason: "docs Q&A can use cheaper model with fallback",
  };
  const allowed: PolicyDecision = {
    allowed: true,
    action: "allow",
    reason: "budget policy allowed request",
    budgetRemaining: 9.5,
  };
  const blocked: PolicyDecision = {
    allowed: false,
    action: "block",
    reason: "request exceeded max_request_cost_usd",
    budgetRemaining: 0,
  };

  return {
    exactCachePlan: planCompute({
      request,
      exactHit: true,
      semanticHit: false,
      prefixCacheEligibleTokens: 0,
      route,
      policy: allowed,
      expectedCostUsd: 0.002,
      riskLevel: "low",
    }),
    semanticCachePlan: planCompute({
      request,
      exactHit: false,
      semanticHit: true,
      prefixCacheEligibleTokens: 500,
      route,
      policy: allowed,
      expectedCostUsd: 0.002,
      riskLevel: "low",
    }),
    budgetBlockPlan: planCompute({
      request,
      exactHit: false,
      semanticHit: false,
      prefixCacheEligibleTokens: 0,
      route,
      policy: blocked,
      expectedCostUsd: 0.25,
      riskLevel: "medium",
    }),
    repeatedContextPlan: planCompute({
      request,
      exactHit: false,
      semanticHit: false,
      prefixCacheEligibleTokens: 2400,
      route,
      policy: allowed,
      expectedCostUsd: 0.002,
      riskLevel: "medium",
    }),
    reason: "AIS maps cache hits, semantic reuse, budget blocks, and repeated context into foreground actions and background tasks",
  };
}

function buildGatewayCompatibilityProof(): GatewayCompatibilityProof {
  const request = normalizeChatCompletionRequest({
    model: "mock",
    messages: [{ role: "user", content: "gateway compatibility proof" }],
  }, { provider: "mock", workloadType: "docs_qa", riskLevel: "low" });
  const response = toOpenAIChatCompletion(request, {
    id: "chatcmpl_readiness",
    model: "mock",
    provider: "mock",
    content: "OpenAI-compatible TokenOps response",
    finish_reason: "stop",
    input_tokens: 12,
    output_tokens: 5,
    latency_ms: 1,
    cost_usd: 0,
  }) as {
    object: string;
    model: string;
    choices?: unknown[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    tokenops?: unknown;
  };
  const responses = toOpenAIResponse(request, {
    id: "resp_readiness_model",
    model: "mock",
    provider: "mock",
    content: "OpenAI-compatible TokenOps response",
    finish_reason: "stop",
    input_tokens: 12,
    output_tokens: 5,
    latency_ms: 1,
    cost_usd: 0,
  }, "resp_readiness") as {
    object: string;
    output_text?: string;
    output?: unknown[];
  };
  const embeddings = toOpenAIEmbeddingResponse({
    model: "text-embedding-3-small",
    input: ["gateway compatibility proof", "adaptive inference cache proof"],
    embeddings: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ],
    promptTokens: 12,
    dimensions: 4,
    id: "emb_readiness",
  }) as {
    object: string;
    data?: Array<{ embedding?: unknown[] }>;
  };
  return {
    object: response.object,
    model: response.model,
    hasChoices: Array.isArray(response.choices) && response.choices.length > 0,
    hasUsage: typeof response.usage?.prompt_tokens === "number" && typeof response.usage?.completion_tokens === "number",
    hasTokenOpsMetadata: Boolean(response.tokenops),
    responsesObject: responses.object,
    responsesHasOutputText: typeof responses.output_text === "string" && responses.output_text.length > 0,
    responsesHasOutput: Array.isArray(responses.output) && responses.output.length > 0,
    embeddingsObject: embeddings.object,
    embeddingsCount: embeddings.data?.length ?? 0,
    embeddingsVectorDimensions: embeddings.data?.[0]?.embedding?.length ?? 0,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    reason: "gateway adapter returns OpenAI-compatible chat.completion, response, and embeddings shapes with usage and TokenOps metadata",
  };
}

function buildCheaperAnalyzerProof(): CheaperAnalyzerProof {
  const insights = analyzeTraces([
    {
      ...routingTrace("analyze_overkill_prefix", 0.002, "gpt-5-mini"),
      requestedModel: "gpt-5.5",
      cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 2400 },
      cost: { estimatedBaselineCost: 0.02, estimatedOptimizedCost: 0.002, estimatedSavings: 0.018 },
      finalResponseSource: "model",
    },
  ]);
  const kinds = [...new Set(insights.map((insight) => insight.kind))];
  return {
    insightCount: insights.length,
    kinds,
    estimatedAvoidableCostUsd: roundMoney(insights.reduce((total, insight) => total + insight.estimatedAvoidableCostUsd, 0)),
    messages: insights.map((insight) => insight.message),
    reason: "post-run analyzer finds overpowered model use, prefix-cache opportunity, and uncached model-call waste",
  };
}

function buildCacheSafetyProof(): CacheSafetyProof {
  const safePrompt = "What does the documentation say about the quickstart and cache setup?";
  const riskyPrompt = "Use this private secret token to wire a payment from my account.";
  const safe = normalizeChatCompletionRequest({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: safePrompt }],
  }, { provider: "mock", workloadType: "docs_qa", riskLevel: "low" });
  const risky = normalizeChatCompletionRequest({
    model: "gpt-5.5",
    messages: [{ role: "user", content: riskyPrompt }],
  }, { provider: "mock", workloadType: "high_risk_action", riskLevel: "high" });
  return {
    safeDocsCacheability: classifyCacheability(safe),
    riskyPrivateCacheability: classifyCacheability(risky),
    safePrompt,
    riskyPrompt,
    reason: "semantic cache is allowed for safe documentation Q&A and blocked for private/payment/secret workloads",
  };
}

function buildPolicyControlsProof(): PolicyControlsProof {
  const request = normalizeChatCompletionRequest({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "large request that should exceed the local budget proof cap" }],
  }, { provider: "mock", workloadType: "agent_planning", riskLevel: "low" });
  const budget = evaluateBudgetPolicy({
    request,
    estimate: { inputTokens: 1000, outputTokens: 1000, inputCostUsd: 0.25, outputCostUsd: 0.75, totalCostUsd: 1 },
    policy: {
      policy_id: "readiness-proof",
      daily_budget_usd: 10,
      max_request_cost_usd: 0.5,
      max_model: "gpt-5.5",
      allow_expensive_models: true,
      block_on_budget_exceeded: true,
      warn_threshold: 0.8,
    },
  });
  const traces = Array.from({ length: 6 }, (_, index) => ({
    ...routingTrace(`loop_${index}`, 0.001, "gpt-5-mini"),
    workloadType: "agent_planning" as const,
    agentId: "agent_readiness",
    normalizedHash: "same-loop-hash",
  }));
  const loop = detectAgentLoop(traces, "agent_readiness");
  return {
    budget,
    loop,
    repeatedTraceCount: traces.length,
    reason: "budget firewall blocks over-cap requests and loop limiter blocks repeated agent prompts before more compute is burned",
  };
}

async function buildVerifierGateProof(): Promise<VerifierGateProof> {
  const request = normalizeChatCompletionRequest({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "verifier gate proof" }],
  }, { provider: "mock", workloadType: "docs_qa", riskLevel: "low" });
  const pass = await cheapThenVerify({
    request,
    cheapProvider: new StaticProvider("cheap", "grounded cheap answer"),
    strongProvider: new StaticProvider("strong", "strong answer should not be used"),
  });
  const fail = await cheapThenVerify({
    request,
    cheapProvider: new StaticProvider("cheap", "ERROR: unsupported cheap answer"),
    strongProvider: new StaticProvider("strong", "strong verified answer"),
  });
  return {
    passCase: {
      verifierPassed: pass.verifierPassed,
      escalatedAfterFail: pass.escalatedAfterFail,
      finalProvider: pass.response.provider,
      finalContent: pass.response.content,
    },
    failCase: {
      verifierPassed: fail.verifierPassed,
      escalatedAfterFail: fail.escalatedAfterFail,
      finalProvider: fail.response.provider,
      finalContent: fail.response.content,
    },
    reason: "cheap answer is served when verifier passes; failed cheap answer escalates to stronger provider",
  };
}

class StaticProvider implements ModelProvider {
  constructor(readonly name: string, private readonly content: string) {}
  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    return {
      id: `${this.name}_response`,
      model: request.requested_model,
      provider: this.name,
      content: this.content,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}

async function buildProviderFallbackProof(): Promise<ProviderFallbackProof> {
  const provider = new FallbackProvider([
    new FailingProvider("groq"),
    new MockProvider(),
  ]);
  const request = normalizeChatCompletionRequest({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "fallback proof" }],
  }, { provider: "fallback", workloadType: "docs_qa", riskLevel: "low" });
  const response = await provider.complete(request);
  const fallback = (response.raw as { tokenops?: { fallback?: { selectedProvider?: string; failedProviders?: string[]; attempts?: Array<{ provider: string; ok: boolean }> } } } | undefined)?.tokenops?.fallback;
  return {
    selectedProvider: fallback?.selectedProvider ?? response.provider,
    failedProviders: fallback?.failedProviders ?? [],
    attempts: fallback?.attempts ?? [],
    content: response.content,
    reason: "primary provider failed; fallback provider returned a usable model response",
  };
}

class FailingProvider implements ModelProvider {
  constructor(readonly name: string) {}
  async complete(_request: NormalizedRequest): Promise<ModelResponse> {
    throw new Error(`${this.name} unavailable for readiness proof`);
  }
}

function buildProviderArbitrageProof(): ProviderArbitrageProof {
  const candidates = ["openai", "groq", "mock"];
  const traces: RequestTrace[] = [
    providerTrace("openai_1", "openai", 0.04, 650),
    providerTrace("openai_2", "openai", 0.04, 700),
    providerTrace("groq_1", "groq", 0.01, 300),
    providerTrace("groq_2", "groq", 0.01, 320),
    providerTrace("mock_unhealthy_1", "mock", 0, 25, false),
    providerTrace("mock_unhealthy_2", "mock", 0, 30, false),
  ];
  const health = providerHealthReport(traces);
  const baseRoute: ModelRoute = {
    selectedProvider: "openai",
    selectedModel: "gpt-5-mini",
    originalRequestedModel: "gpt-5.5",
    downgraded: true,
    escalated: false,
    reason: "baseline provider before trace-derived arbitrage",
  };
  const route = applyProviderArbitrage(baseRoute, health, {
    candidates,
    minHealthScore: 0.8,
    maxP95LatencyMs: 1_000,
  });
  const original = health.providers[baseRoute.selectedProvider];
  const selected = health.providers[route.selectedProvider];
  return {
    originalProvider: baseRoute.selectedProvider,
    selectedProvider: route.selectedProvider,
    candidates,
    originalAverageCostUsd: roundMoney(original?.averageOptimizedCostUsd ?? 0),
    selectedAverageCostUsd: roundMoney(selected?.averageOptimizedCostUsd ?? 0),
    selectedP95LatencyMs: selected?.p95LatencyMs ?? 0,
    selectedHealthScore: selected?.healthScore ?? 0,
    route,
    reason: route.reason,
  };
}

function buildAdaptiveRoutingProof(): AdaptiveRoutingProof {
  const traces = [
    routingTrace("route_1", 0.0002, "gpt-5-mini"),
    routingTrace("route_2", 0.00018, "gpt-5-mini"),
    routingTrace("route_3", 0.00022, "gpt-5-mini"),
    routingTrace("route_4", 0.01, "gpt-5.5"),
  ];
  const policy = learnRoutingPolicy(traces, { minSamples: 2, minVerifierPassRate: 0.9 });
  const baseRoute: ModelRoute = {
    selectedProvider: "groq",
    selectedModel: "gpt-5.5",
    originalRequestedModel: "gpt-5.5",
    downgraded: false,
    escalated: false,
    reason: "baseline route before trace-derived policy",
  };
  const learnedRoute = applyLearnedRouting(baseRoute, { workloadType: "docs_qa", riskLevel: "low" }, policy);
  return {
    historicalTraceCount: traces.length,
    learnedRules: policy.rules.length,
    baseRoute,
    learnedRoute,
    estimatedAvoidedCostUsd: roundMoney(0.01 - 0.0002),
    reason: learnedRoute.reason,
  };
}

function providerTrace(
  id: string,
  provider: string,
  optimizedCost: number,
  latencyMs: number,
  verifierPassed = true,
): RequestTrace {
  return {
    ...routingTrace(id, optimizedCost, "gpt-5-mini"),
    selectedProvider: provider,
    outputTokensEstimated: 16,
    providerLatencyMs: latencyMs,
    routing: {
      selectedProvider: provider,
      selectedModel: "gpt-5-mini",
      originalRequestedModel: "gpt-5.5",
      downgraded: true,
      escalated: false,
      reason: "provider arbitrage fixture",
    },
    quality: { verifierUsed: true, verifierPassed },
  };
}

function routingTrace(id: string, optimizedCost: number, selectedModel: string): RequestTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    workloadType: "docs_qa",
    requestedModel: "gpt-5.5",
    selectedModel,
    selectedProvider: "groq",
    inputTokensEstimated: 100,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: "groq", selectedModel, originalRequestedModel: "gpt-5.5", downgraded: selectedModel !== "gpt-5.5", escalated: false, reason: "historical route" },
    policy: { allowed: true, reason: "budget policy allowed request" },
    cost: { estimatedBaselineCost: 0.01, estimatedOptimizedCost: optimizedCost, estimatedSavings: Math.max(0, 0.01 - optimizedCost) },
    quality: { verifierUsed: true, verifierPassed: true },
    normalizedHash: id,
    finalResponseSource: "model",
  };
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
