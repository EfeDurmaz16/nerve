# TokenOps Adaptive Inference Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing `nerve` inference compiler into TokenOps, an OpenAI-compatible adaptive inference control plane that caches, routes, budgets, verifies, traces, analyzes, and replays model calls before they burn compute.

**Architecture:** Keep the current compile/learn/replay loop intact, and add a serving-time TokenOps layer beside it. The new path normalizes OpenAI-compatible requests, profiles workload, applies budget/cache/routing policy, calls a mock/default provider, records traces and cost decisions, and powers deterministic replay benchmarks.

**Tech Stack:** TypeScript, pnpm workspace, Fastify, better-sqlite3, Vitest, existing `@nerve/*` packages, no frontend.

---

## Working Constraints

- The workspace is `/Users/efebarandurmaz/nerve`.
- The workspace is not currently a git repository. Atomic commits are blocked until git is initialized or the repo is moved under git.
- Existing `nerve` commands and API verbs should not be broken.
- New code/docs should use TokenOps naming unless preserving current package names avoids churn.
- The first proof is CLI/API/demo/replay output, not a UI.

## File Structure

Create or modify these areas:

- Create `config/pricing.json` for configurable model price estimates.
- Create `packages/core/src/*` for TokenOps types, hashing, normalization, pricing, token/cost estimation, and errors.
- Create `packages/profiler/src/*` for workload, complexity, and cacheability classifiers.
- Create `packages/cache/src/*` for exact, semantic, prefix simulation, tool-result, context-block, and cache policy.
- Create `packages/providers/src/*` for provider interface, mock provider, and adapter-ready OpenAI/Anthropic/Gemini/Ollama/vLLM providers.
- Create `packages/router/src/*` for model/provider/fallback routing.
- Create `packages/policy/src/*` for budget, quota, risk policy, and loop limiter.
- Create `packages/ais/src/*` for TokenOps compute planner and foreground/background task decisions.
- Create `packages/ledger/src/*` for request trace, cost ledger, replay store, stats, and analyzer inputs.
- Create `packages/verifier/src/*` for cheap-then-verify serving-path gate. Keep `packages/verifiers` for existing eval graders.
- Create `packages/benchmark/src/*` and `benchmark/datasets/*.jsonl` for baseline-vs-optimized gateway replay.
- Create `packages/gateway/src/*` for OpenAI-compatible request normalization and response adaptation.
- Modify `apps/server/src/index.ts` to mount TokenOps gateway and read endpoints.
- Modify `apps/cli/src/index.ts` and add `apps/cli/bin/tokenops` for TokenOps commands.
- Modify root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, and `vitest.config.ts` as needed for package aliases/tests.
- Add docs under `docs/*.md` and update `README.md`.

## Phase 1: Foundation and Types

### Task 1: Add TokenOps core package

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/hashing.ts`
- Create: `packages/core/src/normalization.ts`
- Create: `packages/core/src/token-estimator.ts`
- Create: `packages/core/src/pricing.ts`
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/index.ts`
- Create: `config/pricing.json`
- Modify: `tsconfig.json`

- [ ] Add package metadata and exports for `@tokenops/core`.
- [ ] Define `NormalizedRequest`, `RequestTrace`, `ComputePlan`, `CacheEntry`, `BudgetPolicy`, `BenchmarkResult`, `ModelResponse`, `CostEstimate`, and OpenAI chat request/response helper types.
- [ ] Implement stable normalized hashing that excludes unstable fields such as id and timestamp.
- [ ] Implement approximate token estimation from messages, tools, and text.
- [ ] Implement configurable pricing lookup from `config/pricing.json` with safe fallback.
- [ ] Add unit tests for request normalization, hash stability, and token/cost estimation.
- [ ] Run `pnpm test -- packages/core`.

### Task 2: Add gateway package

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/src/openai-compatible.ts`
- Create: `packages/gateway/src/request-normalizer.ts`
- Create: `packages/gateway/src/response-adapter.ts`
- Create: `packages/gateway/src/index.ts`
- Create: `packages/gateway/gateway.test.ts`
- Modify: `tsconfig.json`

- [ ] Normalize OpenAI chat completion requests into `NormalizedRequest`.
- [ ] Preserve requested model, messages, tools, temperature, response format, metadata, user id, and agent id.
- [ ] Return OpenAI-compatible non-streaming chat completion responses.
- [ ] Add tests for response shape and normalized hash stability.
- [ ] Run `pnpm test -- packages/gateway`.

## Phase 2: Providers, Ledger, and First Gateway Endpoint

### Task 3: Add providers package

**Files:**
- Create: `packages/providers/package.json`
- Create: `packages/providers/src/provider.ts`
- Create: `packages/providers/src/mock.ts`
- Create: `packages/providers/src/openai.ts`
- Create: `packages/providers/src/anthropic.ts`
- Create: `packages/providers/src/gemini.ts`
- Create: `packages/providers/src/ollama.ts`
- Create: `packages/providers/src/vllm.ts`
- Create: `packages/providers/src/index.ts`
- Create: `packages/providers/providers.test.ts`

- [ ] Define `ModelProvider`.
- [ ] Implement deterministic mock provider for local tests and demo.
- [ ] Add adapter-ready provider stubs that fail clearly when missing config or not implemented.
- [ ] Add tests for mock provider and adapter error behavior.

### Task 4: Add ledger package

**Files:**
- Create: `packages/ledger/package.json`
- Create: `packages/ledger/src/trace-store.ts`
- Create: `packages/ledger/src/cost-ledger.ts`
- Create: `packages/ledger/src/replay-store.ts`
- Create: `packages/ledger/src/stats.ts`
- Create: `packages/ledger/src/index.ts`
- Create: `packages/ledger/ledger.test.ts`

- [ ] Store gateway request traces in-process first, with JSON persistence-ready interfaces.
- [ ] Track cost totals by model, provider, user, and agent.
- [ ] Produce stats for request count, cache hit count, routed model count, and estimated savings.
- [ ] Add tests for trace insert/list/get and cost aggregation.

### Task 5: Mount `/v1/chat/completions`

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/index.ts`
- Create: `apps/server/server.test.ts`

- [ ] Wire gateway normalizer, mock provider, response adapter, and trace store into Fastify.
- [ ] Add `POST /v1/chat/completions`.
- [ ] Add `GET /stats`, `GET /traces`, and `GET /traces/:id`.
- [ ] Keep existing `/v1/compile-task` routes working.
- [ ] Test OpenAI-compatible request/response with Fastify injection.

## Phase 3: Cache and Profiler

### Task 6: Add exact cache

**Files:**
- Create: `packages/cache/package.json`
- Create: `packages/cache/src/exact-cache.ts`
- Create: `packages/cache/src/cache-policy.ts`
- Create: `packages/cache/src/index.ts`
- Create: `packages/cache/cache.test.ts`

- [ ] Implement exact cache keyed by normalized request hash and isolation scope.
- [ ] Track hit count, timestamps, expiration, provenance, and safety class.
- [ ] Add tests for hit, miss, expiry, and user/agent isolation.

### Task 7: Add prefix, semantic, tool-result, and context-block cache modules

**Files:**
- Create: `packages/cache/src/prefix-cache-simulator.ts`
- Create: `packages/cache/src/semantic-cache.ts`
- Create: `packages/cache/src/tool-result-cache.ts`
- Create: `packages/cache/src/context-block-cache.ts`
- Modify: `packages/cache/cache.test.ts`

- [ ] Simulate stable prefix eligibility and estimated provider cache savings.
- [ ] Implement lexical semantic cache only for safe cacheability classes.
- [ ] Implement tool-result cache keyed by tool name, args hash, and resource version.
- [ ] Implement context-block fingerprinting for system prompt, tools, docs, repo context, and retrieved context.
- [ ] Add tests for all cache layers and safety rules.

### Task 8: Add profiler package

**Files:**
- Create: `packages/profiler/package.json`
- Create: `packages/profiler/src/workload-classifier.ts`
- Create: `packages/profiler/src/complexity-estimator.ts`
- Create: `packages/profiler/src/cacheability-classifier.ts`
- Create: `packages/profiler/src/index.ts`
- Create: `packages/profiler/profiler.test.ts`

- [ ] Classify workload types from user/system content and tools.
- [ ] Estimate complexity from token count, tools, code markers, and risk keywords.
- [ ] Classify cacheability as exact, semantic, tool, context, private/risky, or never cache.
- [ ] Add tests for docs QA, support FAQ, code modification, security, financial, and agent-planning cases.

## Phase 4: Routing, Policy, AIS, and Verifier Gate

### Task 9: Add routing package

**Files:**
- Create: `packages/router/package.json`
- Create: `packages/router/src/model-router.ts`
- Create: `packages/router/src/provider-router.ts`
- Create: `packages/router/src/fallback-policy.ts`
- Create: `packages/router/src/index.ts`
- Create: `packages/router/router.test.ts`

- [ ] Route simple safe requests to cheaper models.
- [ ] Escalate high-risk/code-modification workloads.
- [ ] Respect budget policy downgrade/block signals.
- [ ] Return selected provider, model, fallback, flags, and reason.
- [ ] Add tests for downgrade, escalation, fallback, and budget-aware routing.

### Task 10: Add policy package

**Files:**
- Create: `packages/policy/package.json`
- Create: `packages/policy/src/budget-policy.ts`
- Create: `packages/policy/src/quota-policy.ts`
- Create: `packages/policy/src/risk-policy.ts`
- Create: `packages/policy/src/loop-limiter.ts`
- Create: `packages/policy/src/index.ts`
- Create: `packages/policy/policy.test.ts`

- [ ] Implement per-request max cost checks.
- [ ] Implement daily user and agent budget accounting using ledger totals.
- [ ] Implement max output tokens and expensive-model controls.
- [ ] Implement loop detection for repeated prompts/tool calls/context growth.
- [ ] Add tests for block, downgrade, verifier-required, and loop warnings.

### Task 11: Add AIS compute planner

**Files:**
- Create: `packages/ais/package.json`
- Create: `packages/ais/src/compute-planner.ts`
- Create: `packages/ais/src/foreground-path.ts`
- Create: `packages/ais/src/background-scheduler.ts`
- Create: `packages/ais/src/task-types.ts`
- Create: `packages/ais/src/index.ts`
- Create: `packages/ais/ais.test.ts`

- [ ] Produce a `ComputePlan` for every gateway request.
- [ ] Select foreground action from cache, model call, budget block, partial return, or clarification.
- [ ] Add background tasks for cached answer verification, context precompute, trace compression, tool-cache refresh, fallback preparation, and quality evaluation.
- [ ] Add tests for exact cache hit, semantic cache hit, high-risk request, repeated context, and budget block.

### Task 12: Add serving-path verifier gate

**Files:**
- Create: `packages/verifier/package.json`
- Create: `packages/verifier/src/verifier.ts`
- Create: `packages/verifier/src/eval-gate.ts`
- Create: `packages/verifier/src/cheap-then-verify.ts`
- Create: `packages/verifier/src/index.ts`
- Create: `packages/verifier/verifier.test.ts`

- [ ] Implement heuristic verifier output: passed, failed, uncertain, reason, recommended action.
- [ ] Implement cheap-then-verify flow with escalation on failed verifier.
- [ ] Record verifier usage and escalation in `RequestTrace.quality`.
- [ ] Add tests for pass, fail, uncertain, and escalation.

## Phase 5: Benchmark, Analyzer, CLI, and Docs

### Task 13: Add benchmark package and datasets

**Files:**
- Create: `packages/benchmark/package.json`
- Create: `packages/benchmark/src/replay-runner.ts`
- Create: `packages/benchmark/src/report.ts`
- Create: `packages/benchmark/src/index.ts`
- Create: `packages/benchmark/benchmark.test.ts`
- Create: `benchmark/datasets/docs-qa.jsonl`
- Create: `benchmark/datasets/support-faq.jsonl`
- Create: `benchmark/datasets/coding-agent.jsonl`
- Create: `benchmark/datasets/long-prefix.jsonl`
- Create: `benchmark/datasets/agent-loop.jsonl`
- Create: `benchmark/datasets/tool-result-reuse.jsonl`

- [ ] Run baseline direct mock provider calls for every dataset item.
- [ ] Run optimized TokenOps gateway execution for every dataset item.
- [ ] Report model calls, cache hit rates, tool-result reuse, context-block reuse, downgrade rate, verifier escalation rate, token savings, cost reduction, p50/p95 latency, wrong-cache incidents, and quality warnings.
- [ ] Add tests that assert replay output includes every required metric.

### Task 14: Add could-have-been-cheaper analyzer

**Files:**
- Create: `packages/ledger/src/analyzer.ts`
- Create: `packages/ledger/analyzer.test.ts`

- [ ] Report overkill model calls.
- [ ] Report stable prefix savings opportunities.
- [ ] Report repeated tool results.
- [ ] Report repeated planning prompts and looped agents.
- [ ] Support all traces and single-trace analysis.

### Task 15: Add TokenOps CLI surface

**Files:**
- Create: `apps/cli/bin/tokenops`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/package.json`

- [ ] Add `tokenops serve`.
- [ ] Add `tokenops replay <dataset>` and `tokenops replay --all`.
- [ ] Add `tokenops stats`.
- [ ] Add `tokenops trace <id>`.
- [ ] Add `tokenops cache stats` and `tokenops cache clear`.
- [ ] Add `tokenops analyze` and `tokenops analyze --trace <id>`.
- [ ] Add `tokenops budget status`.
- [ ] Add `tokenops demo`.
- [ ] Preserve existing `nerve` command behavior.

### Task 16: Add docs and README update

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/cache-model.md`
- Create: `docs/routing-model.md`
- Create: `docs/ais.md`
- Create: `docs/budget-policy.md`
- Create: `docs/replay-benchmark.md`
- Create: `docs/threat-model.md`
- Create: `docs/quickstart.md`
- Create: `docs/provider-adapters.md`
- Create: `docs/could-have-been-cheaper.md`
- Modify: `README.md`

- [ ] Document TokenOps as an adaptive inference control plane.
- [ ] Document how it differs from LiteLLM and Langfuse/LangSmith.
- [ ] Document OpenAI-compatible setup with `OPENAI_BASE_URL=http://localhost:8787/v1`.
- [ ] Document demo, replay benchmark, API, CLI, safety model, and roadmap.

## Phase 6: Verification and Polish

### Task 17: Full verification

**Files:**
- Modify tests as needed across packages.

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `tokenops replay --all`.
- [ ] Run `tokenops demo`.
- [ ] Start server and call `GET /health`.
- [ ] Call `POST /v1/chat/completions` with a minimal OpenAI-compatible request.
- [ ] Call `GET /stats`, `GET /traces`, `GET /cache/stats`, and `GET /budget/status`.
- [ ] Update final docs with exact verified commands and known limitations.

## Parallel-Agent Workstreams

Use parallel agents for read-heavy and review-heavy work, not concurrent writes to the same files:

- Architecture agent: review existing `nerve` boundaries and validate the package split before implementation.
- Test agent: map required tests to packages and check coverage after each phase.
- Security agent: review cache safety, semantic cache disable rules, trace redaction, provider key handling, and budget bypass risks.
- Docs agent: draft docs after implementation APIs stabilize.
- Benchmark agent: review replay metrics for credibility and hardcoded-result risks.

The main thread owns code integration and avoids overlapping file edits.

## Completion Criteria

- `docs/inspection/current-state.md` exists and is factual.
- `tokenops serve` starts the local OpenAI-compatible gateway.
- `POST /v1/chat/completions` accepts OpenAI-style requests and returns OpenAI-style responses.
- `tokenops replay --all` runs deterministic baseline-vs-optimized benchmarks.
- `tokenops demo` shows cache hits, semantic hits, tool-result reuse, model downgrades, AIS plans, verifier escalations, cost reduction, cheaper-analysis output, and a sample trace.
- `pnpm test` and `pnpm typecheck` pass.
- README contains reproduction steps and clear positioning.
