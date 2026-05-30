import type { BenchmarkResult, ModelResponse, NormalizedRequest } from "@tokenops/core";
import type { RequestTrace } from "@tokenops/core";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { detectAgentLoop, evaluateBudgetPolicy, type LoopSignal, type PolicyDecision } from "@tokenops/policy";
import { FallbackProvider, MockProvider, type ModelProvider } from "@tokenops/providers";
import { applyLearnedRouting, learnRoutingPolicy, type ModelRoute } from "@tokenops/router";
import { cheapThenVerify } from "@tokenops/verifier";
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
    adaptiveRouting: AdaptiveRoutingProof;
    providerFallback: ProviderFallbackProof;
    verifierGate: VerifierGateProof;
    policyControls: PolicyControlsProof;
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
  const adaptiveRouting = buildAdaptiveRoutingProof();
  const providerFallback = await buildProviderFallbackProof();
  const verifierGate = await buildVerifierGateProof();
  const policyControls = buildPolicyControlsProof();

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
    adaptiveRoutingDowngradesFromTraceEvidence: adaptiveRouting.baseRoute.selectedModel !== adaptiveRouting.learnedRoute.selectedModel && adaptiveRouting.learnedRoute.selectedModel === "gpt-5-mini",
    providerFallbackSurvivesPrimaryFailure: providerFallback.selectedProvider === "mock" && providerFallback.failedProviders.includes("groq"),
    verifierGateEscalatesFailedCheapAnswer: verifierGate.passCase.escalatedAfterFail === false && verifierGate.failCase.escalatedAfterFail === true && verifierGate.failCase.finalProvider === "strong",
    policyControlsBlockWastefulCompute: policyControls.budget.action === "block" && policyControls.loop.action === "block",
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
      adaptiveRouting,
      providerFallback,
      verifierGate,
      policyControls,
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
    `- Adaptive routing route: ${report.evidence.adaptiveRouting.baseRoute.selectedModel} -> ${report.evidence.adaptiveRouting.learnedRoute.selectedModel}`,
    `- Adaptive routing avoided cost/request: $${report.evidence.adaptiveRouting.estimatedAvoidedCostUsd}`,
    `- Provider fallback route: ${report.evidence.providerFallback.failedProviders.join(",") || "none"} -> ${report.evidence.providerFallback.selectedProvider}`,
    `- Verifier gate escalation: ${report.evidence.verifierGate.passCase.finalProvider} pass, ${report.evidence.verifierGate.failCase.finalProvider} after fail`,
    `- Policy controls: budget ${report.evidence.policyControls.budget.action}, loop ${report.evidence.policyControls.loop.action}`,
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
