import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  openDb,
  insertTrace,
  insertReceipt,
  getReceipt,
  getPlan,
  listClusters,
  listPatches,
  updatePatchStatus,
  hashJson,
  countTraces,
  insertTokenOpsBenchmarkResult,
  listTokenOpsBenchmarkResults,
  getTokenOpsIdempotencyRecord,
  insertTokenOpsIdempotencyRecord,
  insertTokenOpsProviderAttempt,
  listTokenOpsProviderAttempts,
} from "@nerve/store";
import { TaskEnvelope, Trace, VerifierSpec, parseOrThrow, newId, nowIso } from "@nerve/ir";
import { compileTask } from "@nerve/planner";
import { mineAll } from "@nerve/miner";
import { generateEvals, learn } from "@nerve/learner";
import { runVerifiers } from "@nerve/verifiers";
import { replay } from "@nerve/replay";
import { HashedEmbeddingIndex, SemanticCache, SqliteContextBlockCache, SqliteExactCache, SqliteSemanticCache, SqliteToolResultCache, simulatePrefixCache } from "@tokenops/cache";
import { estimateCost, estimateInputTokens, estimateTextTokens, stableRequestHash, type BudgetPolicy, type NormalizedRequest, type RequestTrace } from "@tokenops/core";
import { normalizeOpenAIChatRequest, normalizeOpenAIEmbeddingsRequest, responsesRequestToChatRequest, toOpenAIChatCompletion, toOpenAIChatCompletionStream, toOpenAIEmbeddingResponse, toOpenAIResponse } from "@tokenops/gateway";
import { SqliteTraceStore, gatewayStats, analyzeTraces, providerHealthReport } from "@tokenops/ledger";
import { classifyWorkload, estimateComplexity } from "@tokenops/profiler";
import { detectAgentLoop, evaluateBudgetPolicy, evaluateQuota, simulateBudgetPolicy } from "@tokenops/policy";
import { applyLearnedRouting, applyProviderArbitrage, applySloRouting, learnRoutingPolicy, learnSloRoutingPolicy, providerFor, routeModel } from "@tokenops/router";
import { InferenceRuntime, QueueFullError, QueueShedError } from "@tokenops/runtime";
import { planCompute } from "@tokenops/ais";
import type { DB } from "@nerve/store";
import { replayAll, replayDataset } from "@tokenops/benchmark";
import { ulid } from "ulid";

const DEFAULT_DB_PATH = process.env.NERVE_DB ?? resolve(homedir(), ".nerve/nerve.db");
const DEFAULT_PORT = Number(process.env.NERVE_PORT ?? process.env.TOKENOPS_PORT ?? 8787);
const DEFAULT_HOST = process.env.NERVE_HOST ?? process.env.TOKENOPS_HOST ?? "127.0.0.1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

loadDotEnv(resolve(REPO_ROOT, ".env"));
loadDotEnv();

const TOKEN = process.env.NERVE_TOKEN ?? process.env.TOKENOPS_TOKEN ?? "";

function selectedProviderName(): string {
  return process.env.TOKENOPS_PROVIDER ?? (process.env.GROQ_API_KEY ? "groq" : "mock");
}

function internalForwardHeaders(headers: Record<string, unknown>): Record<string, string> {
  const forwarded: Record<string, string> = {};
  if (typeof headers.authorization === "string") forwarded.authorization = headers.authorization;
  return forwarded;
}

function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export interface AppState {
  exactCache: Pick<SqliteExactCache, "get" | "set" | "clear" | "stats">;
  semanticCache: Pick<SemanticCache | SqliteSemanticCache, "get" | "set" | "stats">;
  toolResultCache: Pick<SqliteToolResultCache, "stats">;
  contextBlockCache: Pick<SqliteContextBlockCache, "observe" | "stats">;
  traceStore: Pick<SqliteTraceStore, "insert" | "get" | "list" | "clear">;
  runtime?: InferenceRuntime;
}

type IdempotencyReplayBody =
  | { kind: "json"; body: unknown }
  | { kind: "sse"; body: string };

export function createApp(opts: { dbPath?: string; db?: DB; state?: AppState } = {}) {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const db = opts.db ?? openDb(dbPath);
  const state = opts.state ?? {
    exactCache: new SqliteExactCache(db),
    semanticCache: new SqliteSemanticCache(db),
    toolResultCache: new SqliteToolResultCache(db),
    contextBlockCache: new SqliteContextBlockCache(db),
    traceStore: new SqliteTraceStore(db),
  };
  const runtime = state.runtime ?? runtimeFromEnv();
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" } });
  const rateBuckets = new Map<string, number[]>();

  app.addHook("onRequest", async (req, reply) => {
    if (!TOKEN) return;
    if (req.url.startsWith("/health")) return;
    const hdr = req.headers.authorization ?? "";
    if (hdr !== `Bearer ${TOKEN}`) return reply.code(401).send({ error: "unauthorized" });
  });

  function recordReceipt(
    verb: Parameters<typeof insertReceipt>[1]["verb"],
    task_id: string | null,
    inputs: unknown,
    outputs: unknown,
    startMs: number,
  ): string {
    const r = {
      schema_version: "0.1" as const,
      receipt_id: newId("rcpt"),
      verb,
      task_id,
      inputs_hash: hashJson(inputs),
      outputs_hash: hashJson(outputs),
      cost_usd: 0,
      latency_ms: Date.now() - startMs,
      ts: nowIso(),
    };
    insertReceipt(db, r);
    return r.receipt_id;
  }

  app.get("/health", async () => ({ ok: true, product: "TokenOps", db: dbPath, traces: countTraces(db) }));

  app.post("/v1/chat/completions", async (req, reply) => {
    const wantsStream = Boolean((req.body as { stream?: boolean } | undefined)?.stream);
    const idemKey = idempotencyKey(req.headers["idempotency-key"]);
    let request: NormalizedRequest;
    try {
      request = normalizeOpenAIChatRequest(req.body);
    } catch (e) {
      return reply.code(422).send({ error: { message: (e as Error).message, type: "invalid_request_error" } });
    }

    const providerName = selectedProviderName();
    const profile = classifyWorkload(request);
    request = {
      ...request,
      provider: providerName,
      workload_type: profile.workloadType,
      risk_level: profile.riskLevel,
    };
    request = { ...request, normalized_hash: stableRequestHash(request) };
    if (idemKey) {
      const replay = getTokenOpsIdempotencyRecord<IdempotencyReplayBody>(db, "/v1/chat/completions", idemKey);
      if (replay && replay.request_hash !== request.normalized_hash) {
        return reply.code(409).send({
          error: {
            message: "idempotency-key was already used for a different chat completion request",
            type: "idempotency_key_conflict",
          },
        });
      }
      if (replay) {
        reply.header("x-tokenops-idempotency-hit", "true");
        if (replay.trace_id) reply.header("x-tokenops-trace-id", replay.trace_id);
        const replayBody = normalizeIdempotencyReplayBody(replay.response_body);
        if (replayBody.kind === "sse") {
          reply.header("content-type", "text/event-stream; charset=utf-8");
          reply.header("cache-control", "no-cache");
          return reply.code(replay.status_code).send(replayBody.body);
        }
        return reply.code(replay.status_code).send(replayBody.body);
      }
    }
    const complexity = estimateComplexity(request);
    const prefix = simulatePrefixCache(request);
    const contextObservation = state.contextBlockCache.observe(request);
    const inputTokens = estimateInputTokens(request);
    const baselineCost = estimateCost(request.requested_model, inputTokens, request.max_output_tokens ?? 512);
    const tracesForPolicy = state.traceStore.list(10_000);
    const policy = evaluateBudgetPolicy({
      request,
      estimate: baselineCost,
      riskLevel: profile.riskLevel,
      policy: budgetPolicyFromEnv(request),
      spentTodayUsd: spentTodayUsd(tracesForPolicy, request),
    });
    const policyShadow = budgetPolicyShadow(policy);
    const effectivePolicy = policyShadow?.effective ?? policy;
    let route = {
      ...routeModel({ request, workloadType: profile.workloadType, complexity, riskLevel: profile.riskLevel, budgetAction: effectivePolicy.action === "downgrade" ? "downgrade" : "allow" }),
      selectedProvider: providerName,
    };
    const healthReport = providerHealthReport(tracesForPolicy);
    if (process.env.TOKENOPS_ADAPTIVE_ROUTING === "1") {
      route = applyLearnedRouting(
        route,
        { workloadType: profile.workloadType, riskLevel: profile.riskLevel },
        learnRoutingPolicy(tracesForPolicy, {
          minSamples: Number(process.env.TOKENOPS_ROUTING_MIN_SAMPLES ?? 2),
          minVerifierPassRate: Number(process.env.TOKENOPS_ROUTING_MIN_VERIFIER_PASS_RATE ?? 0.8),
        }),
        {
          providerHealth: healthReport,
          minProviderHealthScore: Number(process.env.TOKENOPS_ROUTING_MIN_PROVIDER_HEALTH ?? 0),
        },
      );
    }
    if (process.env.TOKENOPS_PROVIDER_ARBITRAGE === "1") {
      route = applyProviderArbitrage(route, healthReport, {
        candidates: providerArbitrageCandidates(providerName),
        minHealthScore: envNumber("TOKENOPS_PROVIDER_ARBITRAGE_MIN_HEALTH", 0.8),
        maxP95LatencyMs: envNumber("TOKENOPS_PROVIDER_ARBITRAGE_MAX_P95_MS", Number.MAX_SAFE_INTEGER),
      });
    }
    if (process.env.TOKENOPS_SLO_ROUTING === "1") {
      route = applySloRouting(
        route,
        learnSloRoutingPolicy(tracesForPolicy, sloPolicyOptionsFromEnv()),
        { fallbackProviders: providerFallbackNames(providerName) },
      );
    }
    const optimizedCost = estimateCost(route.selectedModel, inputTokens, request.max_output_tokens ?? 512);

    const quota = dailyQuotaDecision(tracesForPolicy, request);
    if (!quota.allowed) {
      const blockedPolicy = { action: "block" as const, allowed: false, reason: quota.reason, budgetRemaining: effectivePolicy.budgetRemaining };
      const blockedPlan = planCompute({
        request,
        exactHit: false,
        semanticHit: false,
        prefixCacheEligibleTokens: prefix.cachedPrefixEligibleTokens,
        route,
        policy: blockedPolicy,
        expectedCostUsd: 0,
        riskLevel: profile.riskLevel,
      });
      const trace = buildTrace({ request, route, policy: blockedPolicy, exactHit: false, semanticHit: false, contextBlockHit: contextObservation.hit, prefixTokens: prefix.cachedPrefixEligibleTokens, baselineCost: baselineCost.totalCostUsd, optimizedCost: 0, outputTokens: 0, source: "blocked", computePlanId: blockedPlan.requestId });
      state.traceStore.insert(trace);
      return reply.code(429).send({ error: { message: quota.reason, type: "quota_policy_block" }, tokenops: { trace_id: trace.id, compute_plan: blockedPlan } });
    }

    const rateLimit = checkRateLimit(rateBuckets, request);
    if (!rateLimit.allowed) {
      const blockedPolicy = { action: "block" as const, allowed: false, reason: rateLimit.reason, budgetRemaining: effectivePolicy.budgetRemaining };
      const blockedPlan = planCompute({
        request,
        exactHit: false,
        semanticHit: false,
        prefixCacheEligibleTokens: prefix.cachedPrefixEligibleTokens,
        route,
        policy: blockedPolicy,
        expectedCostUsd: 0,
        riskLevel: profile.riskLevel,
      });
      const trace = buildTrace({ request, route, policy: blockedPolicy, exactHit: false, semanticHit: false, contextBlockHit: contextObservation.hit, prefixTokens: prefix.cachedPrefixEligibleTokens, baselineCost: baselineCost.totalCostUsd, optimizedCost: 0, outputTokens: 0, source: "blocked", computePlanId: blockedPlan.requestId });
      state.traceStore.insert(trace);
      return reply.code(429).send({ error: { message: rateLimit.reason, type: "rate_limit_exceeded" }, tokenops: { trace_id: trace.id, compute_plan: blockedPlan } });
    }

    const loop = agentLoopDecision(tracesForPolicy, request);
    if (!loop.allowed) {
      const blockedPolicy = { action: "block" as const, allowed: false, reason: loop.reason, budgetRemaining: effectivePolicy.budgetRemaining };
      const blockedPlan = planCompute({
        request,
        exactHit: false,
        semanticHit: false,
        prefixCacheEligibleTokens: prefix.cachedPrefixEligibleTokens,
        route,
        policy: blockedPolicy,
        expectedCostUsd: 0,
        riskLevel: profile.riskLevel,
      });
      const trace = buildTrace({ request, route, policy: blockedPolicy, exactHit: false, semanticHit: false, contextBlockHit: contextObservation.hit, prefixTokens: prefix.cachedPrefixEligibleTokens, baselineCost: baselineCost.totalCostUsd, optimizedCost: 0, outputTokens: 0, source: "blocked", computePlanId: blockedPlan.requestId });
      state.traceStore.insert(trace);
      return reply.code(429).send({ error: { message: loop.reason, type: "agent_loop_block" }, tokenops: { trace_id: trace.id, compute_plan: blockedPlan } });
    }

    let exactHit = false;
    let semanticHit = false;
    let response = state.exactCache.get(request);
    if (response) exactHit = true;
    if (!response) {
      response = state.semanticCache.get(request);
      if (response) semanticHit = true;
    }

    const plan = planCompute({
      request,
      exactHit,
      semanticHit,
      prefixCacheEligibleTokens: prefix.cachedPrefixEligibleTokens,
      route,
      policy: effectivePolicy,
      expectedCostUsd: optimizedCost.totalCostUsd,
      riskLevel: profile.riskLevel,
    });

    if (!effectivePolicy.allowed) {
      const trace = buildTrace({ request, route, policy: effectivePolicy, exactHit, semanticHit, contextBlockHit: contextObservation.hit, prefixTokens: prefix.cachedPrefixEligibleTokens, baselineCost: baselineCost.totalCostUsd, optimizedCost: 0, outputTokens: 0, source: "blocked", computePlanId: plan.requestId });
      state.traceStore.insert(trace);
      return reply.code(402).send({ error: { message: effectivePolicy.reason, type: "budget_policy_block" }, tokenops: { trace_id: trace.id, compute_plan: plan } });
    }

    let runtimeCoalesced = false;
    if (!response) {
      const providerStarted = Date.now();
      try {
        const runtimeResult = await runtime.execute({
          providerKey: route.selectedProvider,
          coalesceKey: providerCoalesceKey(request, route),
          priority: runtimePriorityForRequest(request),
          run: () => providerFor(route.selectedProvider).complete({ ...request, provider: route.selectedProvider, requested_model: route.selectedModel }),
        });
        runtimeCoalesced = runtimeResult.coalesced;
        response = runtimeResult.value;
      } catch (e) {
        const admissionError = e instanceof QueueShedError || e instanceof QueueFullError;
        const errorType = e instanceof QueueShedError
          ? "inference_queue_shed"
          : e instanceof QueueFullError
            ? "inference_queue_full"
            : "provider_error";
        const statusCode = e instanceof QueueShedError ? 503 : e instanceof QueueFullError ? 429 : 502;
        const errorPolicy = {
          action: "block" as const,
          allowed: false,
          reason: admissionError ? `runtime admission control: ${(e as Error).message}` : `provider error: ${(e as Error).message}`,
          budgetRemaining: effectivePolicy.budgetRemaining,
        };
        const trace = buildTrace({
          request,
          route,
          policy: errorPolicy,
          exactHit,
          semanticHit,
          contextBlockHit: contextObservation.hit,
          prefixTokens: prefix.cachedPrefixEligibleTokens,
          baselineCost: baselineCost.totalCostUsd,
          optimizedCost: 0,
          outputTokens: 0,
          providerLatencyMs: Date.now() - providerStarted,
          source: admissionError ? "blocked" : "provider_error",
          computePlanId: plan.requestId,
        });
        state.traceStore.insert(trace);
        if (!admissionError) {
          recordProviderAttempts(db, trace.id, request, route.selectedModel, route.selectedProvider, undefined, false, Date.now() - providerStarted, (e as Error).message);
        }
        reply.header("x-tokenops-trace-id", trace.id);
        return reply.code(statusCode).send({
          error: {
            message: (e as Error).message,
            type: errorType,
          },
          tokenops: { provider: route.selectedProvider, route, trace_id: trace.id, runtime: { stats: runtime.stats() } },
        });
      }
      state.exactCache.set(request, response);
      state.semanticCache.set(request, response);
    }

    const effectiveRoute = response.provider !== route.selectedProvider
      ? { ...route, selectedProvider: response.provider, reason: `${route.reason}; fallback selected provider ${response.provider}` }
      : route;

    const trace = buildTrace({
      request,
      route: effectiveRoute,
      policy: effectivePolicy,
      exactHit,
      semanticHit,
      contextBlockHit: contextObservation.hit,
      prefixTokens: prefix.cachedPrefixEligibleTokens,
      baselineCost: baselineCost.totalCostUsd,
      optimizedCost: exactHit || semanticHit || runtimeCoalesced ? 0 : optimizedCost.totalCostUsd,
      outputTokens: response.output_tokens,
      providerLatencyMs: exactHit || semanticHit || runtimeCoalesced ? 0 : response.latency_ms,
      source: exactHit ? "exact_cache" : semanticHit ? "semantic_cache" : "model",
      computePlanId: plan.requestId,
    });
    state.traceStore.insert(trace);
    recordProviderAttempts(db, trace.id, request, route.selectedModel, effectiveRoute.selectedProvider, response, exactHit || semanticHit || runtimeCoalesced, response.latency_ms);
    reply.header("x-tokenops-trace-id", trace.id);
    if (wantsStream) {
      const streamBody = toOpenAIChatCompletionStream(response);
      if (idemKey) {
        insertTokenOpsIdempotencyRecord<IdempotencyReplayBody>(db, {
          route: "/v1/chat/completions",
          key: idemKey,
          request_hash: request.normalized_hash,
          status_code: 200,
          trace_id: trace.id,
          response_body: { kind: "sse", body: streamBody },
          created_at: new Date().toISOString(),
        });
      }
      reply.header("content-type", "text/event-stream; charset=utf-8");
      reply.header("cache-control", "no-cache");
      return reply.send(streamBody);
    }
    const completion = toOpenAIChatCompletion(request, response);
    const body = {
      ...completion,
      tokenops: {
        ...completion.tokenops,
        trace_id: trace.id,
        compute_plan: plan,
        cache: trace.cache,
        routing: trace.routing,
        policy: trace.policy,
        ...(policyShadow ? { policy_shadow: { mode: "shadow", decision: policyShadow.observed } } : {}),
        runtime: { coalesced: runtimeCoalesced, stats: runtime.stats() },
      },
    };
    if (idemKey) {
      insertTokenOpsIdempotencyRecord<IdempotencyReplayBody>(db, {
        route: "/v1/chat/completions",
        key: idemKey,
        request_hash: request.normalized_hash,
        status_code: 200,
        trace_id: trace.id,
        response_body: { kind: "json", body },
        created_at: new Date().toISOString(),
      });
    }
    return body;
  });

  app.post("/v1/responses", async (req, reply) => {
    let chatPayload: ReturnType<typeof responsesRequestToChatRequest>;
    try {
      chatPayload = responsesRequestToChatRequest(req.body);
    } catch (e) {
      return reply.code(422).send({ error: { message: (e as Error).message, type: "invalid_request_error" } });
    }
    if (chatPayload.stream) {
      return reply.code(422).send({ error: { message: "streaming /v1/responses is not implemented; use /v1/chat/completions with stream=true", type: "unsupported_feature" } });
    }

    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: internalForwardHeaders(req.headers),
      payload: chatPayload,
    });
    reply.code(chat.statusCode);
    for (const [key, value] of Object.entries(chat.headers)) {
      if (value !== undefined) reply.header(key, value);
    }
    const chatBody = JSON.parse(chat.body) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      tokenops?: Record<string, unknown>;
      error?: unknown;
    };
    if (chat.statusCode >= 400 || chatBody.error) return chatBody;
    const normalized = normalizeOpenAIChatRequest(chatPayload);
    const modelResponse = {
      id: chatBody.id ?? `resp_${ulid()}`,
      model: chatBody.model ?? chatPayload.model,
      provider: typeof chatBody.tokenops?.provider === "string" ? chatBody.tokenops.provider : selectedProviderName(),
      content: chatBody.choices?.[0]?.message?.content ?? "",
      finish_reason: chatBody.choices?.[0]?.finish_reason ?? "stop",
      input_tokens: chatBody.usage?.prompt_tokens ?? 0,
      output_tokens: chatBody.usage?.completion_tokens ?? 0,
      latency_ms: typeof chatBody.tokenops?.latency_ms === "number" ? chatBody.tokenops.latency_ms : 0,
      cost_usd: typeof chatBody.tokenops?.cost_usd === "number" ? chatBody.tokenops.cost_usd : 0,
    };
    return {
      ...toOpenAIResponse(normalized, modelResponse, `resp_${ulid()}`),
      tokenops: chatBody.tokenops,
    };
  });

  app.post("/v1/embeddings", async (req, reply) => {
    let embeddingRequest: ReturnType<typeof normalizeOpenAIEmbeddingsRequest>;
    try {
      embeddingRequest = normalizeOpenAIEmbeddingsRequest(req.body);
    } catch (e) {
      return reply.code(422).send({ error: { message: (e as Error).message, type: "invalid_request_error" } });
    }

    const index = new HashedEmbeddingIndex(embeddingRequest.dimensions);
    const embeddings = embeddingRequest.input.map((input) => index.embed(input));
    const promptTokens = embeddingRequest.input.reduce((total, input) => total + estimateTextTokens(input), 0);
    return toOpenAIEmbeddingResponse({
      id: `emb_${ulid()}`,
      model: embeddingRequest.model,
      input: embeddingRequest.input,
      embeddings,
      promptTokens,
      dimensions: embeddingRequest.dimensions,
    });
  });

  app.get("/stats", async () => {
    const traces = state.traceStore.list(10_000);
    return { ...gatewayStats(traces), provider_health: providerHealthReport(traces) };
  });
  app.get("/traces", async (req) => ({ traces: state.traceStore.list(Number((req.query as { limit?: string }).limit ?? 100)) }));
  app.get("/traces/:id", async (req, reply) => {
    const trace = state.traceStore.get((req.params as { id: string }).id);
    if (!trace) return reply.code(404).send({ error: "not found" });
    return trace;
  });
  app.get("/cache/stats", async () => ({ exact: state.exactCache.stats(), semantic: state.semanticCache.stats(), tool: state.toolResultCache.stats(), context: state.contextBlockCache.stats() }));
  app.post("/cache/clear", async () => {
    state.exactCache.clear();
    return { ok: true };
  });
  app.get("/budget/status", async () => {
    const traces = state.traceStore.list(10_000);
    return {
      policy: budgetPolicyFromEnv(),
      spent_today_usd: spentTodayUsd(traces),
      stats: gatewayStats(traces).cost,
      quota: {
        max_requests_per_user_per_day: optionalInt("TOKENOPS_MAX_REQUESTS_PER_USER_PER_DAY"),
        max_requests_per_agent_per_day: optionalInt("TOKENOPS_MAX_REQUESTS_PER_AGENT_PER_DAY"),
      },
      rate_limit: { per_minute: optionalInt("TOKENOPS_RATE_LIMIT_PER_MINUTE") },
    };
  });
  app.post("/policy/simulate", async (req, reply) => {
    const body = (req.body ?? {}) as { policy?: Partial<BudgetPolicy>; limit?: number };
    const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(100_000, Number(body.limit))) : 10_000;
    try {
      return simulateBudgetPolicy(state.traceStore.list(limit), { policy: budgetPolicyFromPartial(body.policy) });
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });
  app.get("/rate-limit/status", async () => ({ per_minute: optionalInt("TOKENOPS_RATE_LIMIT_PER_MINUTE"), buckets: rateBuckets.size }));
  app.get("/providers/health", async () => providerHealthReport(state.traceStore.list(10_000)));
  app.get("/providers/attempts", async (req) => ({ attempts: listTokenOpsProviderAttempts(db, { limit: Number((req.query as { limit?: string }).limit ?? 100), traceId: (req.query as { trace?: string }).trace }) }));
  app.get("/runtime/stats", async () => runtime.stats());
  app.get("/routing/policy", async () => learnRoutingPolicy(state.traceStore.list(10_000), {
    minSamples: Number(process.env.TOKENOPS_ROUTING_MIN_SAMPLES ?? 2),
    minVerifierPassRate: Number(process.env.TOKENOPS_ROUTING_MIN_VERIFIER_PASS_RATE ?? 0.8),
  }));
  app.get("/routing/slo", async () => learnSloRoutingPolicy(state.traceStore.list(10_000), sloPolicyOptionsFromEnv()));
  app.get("/benchmark/results", async (req) => ({ results: listTokenOpsBenchmarkResults(db, Number((req.query as { limit?: string }).limit ?? 100)) }));
  app.post("/replay", async (req, reply) => {
    const body = (req.body ?? {}) as { dataset?: string; all?: boolean };
    try {
      const dataset = body.dataset ?? "benchmark/datasets/docs-qa.jsonl";
      const results = body.all ? await replayAll(resolve(REPO_ROOT, "benchmark/datasets")) : [await replayDataset(isAbsolute(dataset) ? dataset : resolve(REPO_ROOT, dataset))];
      for (const result of results) insertTokenOpsBenchmarkResult(db, `bm_${ulid()}`, result);
      return { results };
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });
  app.get("/analyze", async (req) => ({ insights: analyzeTraces(state.traceStore.list(10_000), (req.query as { trace?: string }).trace) }));

  app.post("/v1/compile-task", async (req, reply) => {
    const start = Date.now();
    const body = req.body as { task?: unknown };
    if (!body?.task) return reply.code(400).send({ error: "missing 'task'" });
    let task: TaskEnvelope;
    try {
      task = parseOrThrow(TaskEnvelope, {
        ...(body.task as object),
        task_id: (body.task as TaskEnvelope).task_id ?? newId("tsk"),
        created_at: (body.task as TaskEnvelope).created_at ?? nowIso(),
      });
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
    const result = compileTask(db, task);
    const receipt_id = recordReceipt("compile-task", task.task_id, body, result, start);
    reply.header("x-receipt-id", receipt_id);
    return { ...result, receipt_id };
  });

  app.post("/v1/record-trace", async (req, reply) => {
    const start = Date.now();
    const body = req.body as { trace?: unknown };
    if (!body?.trace) return reply.code(400).send({ error: "missing 'trace'" });
    let trace: Trace;
    try {
      trace = parseOrThrow(Trace, body.trace);
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
    insertTrace(db, trace);
    mineAll(db);
    const out = { trace_id: trace.trace_id, accepted_events: trace.events.length, outcome: trace.outcome };
    const receipt_id = recordReceipt("record-trace", trace.task_id, body, out, start);
    reply.header("x-receipt-id", receipt_id);
    return { ...out, receipt_id };
  });

  app.post("/v1/generate-evals", async (req, reply) => {
    const start = Date.now();
    const body = (req.body as { cluster_ids?: string[] | null; max_per_cluster?: number }) ?? {};
    const out = generateEvals(db, body);
    const receipt_id = recordReceipt("generate-evals", null, body, out, start);
    reply.header("x-receipt-id", receipt_id);
    return { ...out, receipt_id };
  });

  app.post("/v1/learn", async (req, reply) => {
    const start = Date.now();
    const body = (req.body as { cluster_ids?: string[] | null }) ?? {};
    const out = learn(db, body);
    const receipt_id = recordReceipt("learn", null, body, out, start);
    reply.header("x-receipt-id", receipt_id);
    return { ...out, receipt_id };
  });

  const VerifyBody = z.object({
    plan_id: z.string().nullable().optional(),
    verifiers: z.array(VerifierSpec).nullable().optional(),
    input: z.unknown(),
    output: z.unknown(),
  });

  app.post("/v1/verify", async (req, reply) => {
    const start = Date.now();
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.message });
    const { plan_id, verifiers, input, output } = parsed.data;
    let specs = verifiers ?? [];
    if (specs.length === 0 && plan_id) {
      const plan = getPlan(db, plan_id);
      if (!plan) return reply.code(404).send({ error: "plan not found" });
      specs = plan.verifiers;
    }
    if (specs.length === 0) return reply.code(400).send({ error: "no verifiers" });
    const r = await runVerifiers(input, output, specs);
    const receipt_id = recordReceipt("verify", null, req.body, r, start);
    reply.header("x-receipt-id", receipt_id);
    return { ...r, receipt_id };
  });

  const ReplayBody = z.object({
    patch_ids: z.array(z.string()),
    baseline: z.string().default("current_policy"),
    eval_ids: z.array(z.string()).nullable().optional(),
    sample: z.number().int().positive().optional(),
  });

  app.post("/v1/replay", async (req, reply) => {
    const start = Date.now();
    const parsed = ReplayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.message });
    const out = replay(db, {
      patch_ids: parsed.data.patch_ids,
      baseline: parsed.data.baseline as "current_policy",
      eval_ids: parsed.data.eval_ids ?? null,
      sample: parsed.data.sample,
    });
    const receipt_id = recordReceipt("replay", null, req.body, out, start);
    reply.header("x-receipt-id", receipt_id);
    return { ...out, receipt_id };
  });

  app.get("/v1/receipts/:id", async (req, reply) => {
    const r = getReceipt(db, (req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ error: "not found" });
    return r;
  });
  app.get("/v1/clusters", async () => ({ clusters: listClusters(db) }));
  app.get("/v1/patches", async (req) => ({ patches: listPatches(db, { status: (req.query as { status?: string }).status }) }));
  app.post("/v1/patches/:id/approve", async (req) => {
    const id = (req.params as { id: string }).id;
    updatePatchStatus(db, id, "live");
    return { ok: true, id, status: "live" };
  });
  app.post("/v1/patches/:id/reject", async (req) => {
    const id = (req.params as { id: string }).id;
    updatePatchStatus(db, id, "rejected");
    return { ok: true, id, status: "rejected" };
  });

  return app;
}

function budgetPolicyFromEnv(request?: NormalizedRequest): BudgetPolicy {
  return {
    policy_id: process.env.TOKENOPS_BUDGET_POLICY_ID ?? "local-default",
    user_id: request?.user_id,
    agent_id: request?.agent_id,
    daily_budget_usd: envNumber("TOKENOPS_DAILY_BUDGET_USD", 10),
    max_request_cost_usd: envNumber("TOKENOPS_MAX_REQUEST_COST_USD", 0.5),
    max_model: process.env.TOKENOPS_MAX_MODEL ?? "gpt-5.5",
    allow_expensive_models: envBool("TOKENOPS_ALLOW_EXPENSIVE_MODELS", true),
    block_on_budget_exceeded: envBool("TOKENOPS_BLOCK_ON_BUDGET_EXCEEDED", true),
    warn_threshold: envNumber("TOKENOPS_BUDGET_WARN_THRESHOLD", 0.8),
  };
}

function budgetPolicyFromPartial(input?: Partial<BudgetPolicy>): BudgetPolicy {
  const base = budgetPolicyFromEnv();
  if (!input) return base;
  return {
    ...base,
    ...input,
    policy_id: typeof input.policy_id === "string" ? input.policy_id : base.policy_id,
    daily_budget_usd: finiteNumber(input.daily_budget_usd, base.daily_budget_usd),
    max_request_cost_usd: finiteNumber(input.max_request_cost_usd, base.max_request_cost_usd),
    warn_threshold: finiteNumber(input.warn_threshold, base.warn_threshold),
    max_model: typeof input.max_model === "string" ? input.max_model : base.max_model,
    allow_expensive_models: typeof input.allow_expensive_models === "boolean" ? input.allow_expensive_models : base.allow_expensive_models,
    block_on_budget_exceeded: typeof input.block_on_budget_exceeded === "boolean" ? input.block_on_budget_exceeded : base.block_on_budget_exceeded,
  };
}

function budgetPolicyShadow(policy: ReturnType<typeof evaluateBudgetPolicy>): {
  observed: ReturnType<typeof evaluateBudgetPolicy>;
  effective: ReturnType<typeof evaluateBudgetPolicy>;
} | null {
  if (process.env.TOKENOPS_POLICY_MODE !== "shadow" && process.env.TOKENOPS_BUDGET_POLICY_MODE !== "shadow") return null;
  if (policy.allowed) return null;
  return {
    observed: policy,
    effective: {
      ...policy,
      action: "allow",
      allowed: true,
      reason: `shadow mode: would have ${policy.action}; ${policy.reason}`,
    },
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function spentTodayUsd(traces: RequestTrace[], request?: NormalizedRequest): number {
  const today = new Date().toISOString().slice(0, 10);
  return traces
    .filter((trace) => trace.timestamp.slice(0, 10) === today)
    .filter((trace) => !request?.user_id || trace.userId === request.user_id)
    .filter((trace) => !request?.agent_id || trace.agentId === request.agent_id)
    .reduce((sum, trace) => sum + trace.cost.estimatedOptimizedCost, 0);
}

function dailyQuotaDecision(traces: RequestTrace[], request: NormalizedRequest): { allowed: boolean; reason: string } {
  const today = new Date().toISOString().slice(0, 10);
  const maxUser = optionalInt("TOKENOPS_MAX_REQUESTS_PER_USER_PER_DAY");
  if (maxUser !== undefined && request.user_id) {
    const count = traces.filter((trace) => trace.timestamp.slice(0, 10) === today && trace.userId === request.user_id).length;
    const decision = evaluateQuota(count, maxUser);
    if (!decision.allowed) return { allowed: false, reason: `daily user request quota exceeded (${count}/${maxUser})` };
  }
  const maxAgent = optionalInt("TOKENOPS_MAX_REQUESTS_PER_AGENT_PER_DAY");
  if (maxAgent !== undefined && request.agent_id) {
    const count = traces.filter((trace) => trace.timestamp.slice(0, 10) === today && trace.agentId === request.agent_id).length;
    const decision = evaluateQuota(count, maxAgent);
    if (!decision.allowed) return { allowed: false, reason: `daily agent request quota exceeded (${count}/${maxAgent})` };
  }
  return { allowed: true, reason: "quota available" };
}

function checkRateLimit(buckets: Map<string, number[]>, request: NormalizedRequest): { allowed: boolean; reason: string } {
  const limit = optionalInt("TOKENOPS_RATE_LIMIT_PER_MINUTE");
  if (!limit) return { allowed: true, reason: "rate limit disabled" };
  const key = request.user_id ? `user:${request.user_id}` : request.agent_id ? `agent:${request.agent_id}` : "anon";
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (buckets.get(key) ?? []).filter((ts) => ts >= windowStart);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { allowed: false, reason: `rate limit exceeded for ${key} (${recent.length}/${limit} per minute)` };
  }
  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true, reason: "rate limit available" };
}

function agentLoopDecision(traces: RequestTrace[], request: NormalizedRequest): { allowed: boolean; reason: string } {
  const maxRepeats = optionalInt("TOKENOPS_AGENT_LOOP_MAX_REPEATS") ?? 6;
  if (!request.agent_id || maxRepeats <= 0) return { allowed: true, reason: "agent loop limiter disabled" };
  const recent = traces.filter((trace) => trace.agentId === request.agent_id).slice(0, 20);
  const repeatedWithCurrent = recent.filter((trace) => trace.normalizedHash === request.normalized_hash).length + 1;
  if (repeatedWithCurrent >= maxRepeats) {
    return { allowed: false, reason: `This agent repeated the same prompt ${repeatedWithCurrent} times.` };
  }
  const signal = detectAgentLoop(recent, request.agent_id);
  if (signal.action === "block" || signal.action === "require_approval") return { allowed: false, reason: signal.reason };
  return { allowed: true, reason: signal.reason };
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function optionalInt(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function runtimeFromEnv(): InferenceRuntime {
  return new InferenceRuntime({
    maxConcurrent: optionalInt("TOKENOPS_MAX_CONCURRENT_INFERENCE") ?? 8,
    maxQueue: optionalInt("TOKENOPS_MAX_INFERENCE_QUEUE") ?? 100,
    circuitFailureThreshold: optionalInt("TOKENOPS_CIRCUIT_FAILURE_THRESHOLD") ?? 3,
    circuitCooldownMs: optionalInt("TOKENOPS_CIRCUIT_COOLDOWN_MS") ?? 30_000,
  });
}

function sloPolicyOptionsFromEnv(): Parameters<typeof learnSloRoutingPolicy>[1] {
  return {
    windowSize: optionalInt("TOKENOPS_SLO_WINDOW_SIZE") ?? 100,
    maxErrorRate: envNumber("TOKENOPS_SLO_MAX_ERROR_RATE", 0.1),
    maxP95LatencyMs: envNumber("TOKENOPS_SLO_MAX_P95_LATENCY_MS", 10_000),
    maxAverageCostUsd: envNumber("TOKENOPS_SLO_MAX_AVERAGE_COST_USD", Number.MAX_SAFE_INTEGER),
  };
}

function providerFallbackNames(providerName: string): string[] {
  const names = providerName.split(",").map((name) => name.trim()).filter(Boolean);
  return names.length > 1 ? names.slice(1) : ["mock"];
}

function providerArbitrageCandidates(providerName: string): string[] {
  const configured = process.env.TOKENOPS_PROVIDER_CANDIDATES;
  return (configured ?? providerName).split(",").map((name) => name.trim()).filter(Boolean);
}

function providerCoalesceKey(request: NormalizedRequest, route: ReturnType<typeof routeModel>): string {
  return [route.selectedProvider, route.selectedModel, request.normalized_hash].join(":");
}

function runtimePriorityForRequest(request: NormalizedRequest): number {
  const raw = request.metadata.tokenops_priority ?? request.metadata.tokenopsPriority ?? request.metadata.priority;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return Math.trunc(parsed);
  if (request.workload_type === "verification") return -5;
  if (request.workload_type === "agent_planning" || request.workload_type === "agent_tool_reasoning") return -1;
  return 0;
}

function idempotencyKey(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 256 ? trimmed : undefined;
}

function normalizeIdempotencyReplayBody(value: unknown): IdempotencyReplayBody {
  if (isRecord(value) && value.kind === "sse" && typeof value.body === "string") return value as IdempotencyReplayBody;
  if (isRecord(value) && value.kind === "json" && "body" in value) return value as IdempotencyReplayBody;
  return { kind: "json", body: value };
}

function recordProviderAttempts(
  db: DB,
  traceId: string,
  request: NormalizedRequest,
  model: string,
  selectedProvider: string,
  response: { raw?: unknown } | undefined,
  servedWithoutProviderCall: boolean,
  latencyMs: number,
  error?: string,
): void {
  if (servedWithoutProviderCall) return;
  const fallbackAttempts = extractFallbackAttempts(response?.raw);
  const attempts = fallbackAttempts.length > 0
    ? fallbackAttempts
    : [{ provider: selectedProvider, ok: error === undefined, error }];
  attempts.forEach((attempt, index) => {
    insertTokenOpsProviderAttempt(db, {
      id: `att_${traceId.slice(3)}_${index}`,
      trace_id: traceId,
      request_hash: request.normalized_hash,
      provider: attempt.provider,
      model,
      ok: attempt.ok,
      error: attempt.error,
      latency_ms: attempt.ok ? latencyMs : 0,
      created_at: new Date(Date.now() + index).toISOString(),
    });
  });
}

function extractFallbackAttempts(raw: unknown): Array<{ provider: string; ok: boolean; error?: string }> {
  if (!isRecord(raw) || !isRecord(raw.tokenops) || !isRecord(raw.tokenops.fallback)) return [];
  const attempts = raw.tokenops.fallback.attempts;
  if (!Array.isArray(attempts)) return [];
  return attempts.flatMap((attempt) => {
    if (!isRecord(attempt) || typeof attempt.provider !== "string" || typeof attempt.ok !== "boolean") return [];
    return [{
      provider: attempt.provider,
      ok: attempt.ok,
      error: typeof attempt.error === "string" ? redactProviderAttemptError(attempt.error) : undefined,
    }];
  });
}

function redactProviderAttemptError(error: string): string {
  return error
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildTrace(input: {
  request: Parameters<typeof routeModel>[0]["request"];
  route: ReturnType<typeof routeModel>;
  policy: ReturnType<typeof evaluateBudgetPolicy>;
  exactHit: boolean;
  semanticHit: boolean;
  contextBlockHit: boolean;
  prefixTokens: number;
  baselineCost: number;
  optimizedCost: number;
  outputTokens: number;
  providerLatencyMs?: number;
  source: RequestTrace["finalResponseSource"];
  computePlanId: string;
}): RequestTrace {
  return {
    id: `tr_${input.request.id.slice(4)}`,
    timestamp: new Date().toISOString(),
    workloadType: input.request.workload_type,
    userId: input.request.user_id,
    agentId: input.request.agent_id,
    requestedModel: input.request.requested_model,
    selectedModel: input.route.selectedModel,
    selectedProvider: input.route.selectedProvider,
    inputTokensEstimated: estimateInputTokens(input.request),
    outputTokensEstimated: input.outputTokens,
    providerLatencyMs: input.providerLatencyMs,
    cache: {
      exactHit: input.exactHit,
      semanticHit: input.semanticHit,
      toolResultHit: false,
      contextBlockHit: input.contextBlockHit,
      prefixCacheEligibleTokens: input.prefixTokens,
    },
    routing: {
      selectedProvider: input.route.selectedProvider,
      selectedModel: input.route.selectedModel,
      originalRequestedModel: input.route.originalRequestedModel,
      downgraded: input.route.downgraded,
      escalated: input.route.escalated,
      reason: input.route.reason,
    },
    policy: { allowed: input.policy.allowed, reason: input.policy.reason, budgetRemaining: input.policy.budgetRemaining },
    cost: {
      estimatedBaselineCost: input.baselineCost,
      estimatedOptimizedCost: input.optimizedCost,
      estimatedSavings: Math.max(0, input.baselineCost - input.optimizedCost),
    },
    quality: { verifierUsed: input.request.risk_level === "high" || input.semanticHit },
    computePlanId: input.computePlanId,
    normalizedHash: input.request.normalized_hash,
    finalResponseSource: input.source,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  createApp()
    .listen({ port: DEFAULT_PORT, host: DEFAULT_HOST })
    .then(() => {
      console.log(`TokenOps listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}  db=${DEFAULT_DB_PATH}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
