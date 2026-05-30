# Current State Inspection

Date: 2026-05-30

Project inspected: `/Users/efebarandurmaz/nerve`

Product direction: evolve `nerve` into TokenOps, an adaptive inference control plane for AI apps and agents.

## 1. Existing Project Purpose

The current project is an inference compiler for agents named `nerve`.

The README positions it as:

- an agent-facing compile step before model execution
- a way to turn a task into a `ComputePlan`
- a trace ingestion, failure mining, learning, eval generation, and replay loop
- provider-agnostic, but explicitly not a gateway proxy

The existing thesis is close to TokenOps, but the product boundary is different. Current `nerve` tells an agent what to call through `/v1/compile-task`; TokenOps must also sit directly on the serving path as an OpenAI-compatible gateway at `/v1/chat/completions`.

I found nearby local repos/directories:

- `/Users/efebarandurmaz/nerve`
- `/Users/efebarandurmaz/sardis`
- `/Users/efebarandurmaz/Desktop/sardis`
- `/Users/efebarandurmaz/fides`
- `/Users/efebarandurmaz/OAPS`
- `/Users/efebarandurmaz/agit`
- `/Users/efebarandurmaz/osp`
- `/Users/efebarandurmaz/st-proj-mk/osp`

I could not find separate local folders named `tokenops`, `inference-cdn`, `adaptive-inference-cdn`, `adaptive-inference-control-plane`, `computeplane`, or `ais` within the searched home-directory depth. The current `nerve` repo is the best existing base to evolve.

Important repository fact: `/Users/efebarandurmaz/nerve` is not currently a git repository. `git status` and `git log` both fail with `fatal: not a git repository`.

## 2. Current Package/Module Structure

The project is a TypeScript pnpm monorepo.

Top-level files:

- `package.json` - root scripts for build, test, typecheck, demo, seed
- `pnpm-workspace.yaml` - includes `apps/*` and `packages/*`
- `tsconfig.json` and `tsconfig.base.json` - strict TypeScript config and workspace path aliases
- `vitest.config.ts` - Vitest config
- `README.md`, `THESIS.md`, `TRACTION.md`, `VERIFICATION.md`, `X_DEMO_SCRIPT.md` - product and demo documentation
- `scripts/demo.sh` - deterministic local demo
- `examples/openai-traces/*.jsonl` - seeded trace fixtures
- `examples/sdk-demo/agent.ts` and `examples/sdk-demo/task.json` - SDK demo
- `research/*.md` - product, architecture, API, and OSS research notes

Apps:

- `apps/server` - Fastify HTTP API
- `apps/cli` - `nerve` CLI

Packages:

- `packages/ir` - Zod schemas and TypeScript types for task envelopes, compute plans, traces, failure clusters, eval cases, patches, and receipts
- `packages/store` - better-sqlite3 wrapper, schema migration, DAO helpers, stable JSON hashing
- `packages/planner` - `compileTask` implementation, heuristic risk classifier, context pack builder, teaching selector, deterministic model table, budget planner
- `packages/miner` - failure clustering by deterministic signatures
- `packages/learner` - cluster-to-teaching, cluster-to-patch, and eval generation
- `packages/replay` - simulated replay runner with before/after patch evaluation
- `packages/verifiers` - schema, regex, exec, and heuristic `llm_judge` verifier/grader functions
- `packages/importers` - JSONL importer for native and OpenAI-style trace records
- `packages/sdk-ts` - typed client for the current HTTP verbs

## 3. Existing Features

The current project already includes:

- TypeScript-first workspace with Node 20, pnpm, strict TS config, and Vitest.
- Fastify HTTP server.
- CLI with commands:
  - `nerve init`
  - `nerve serve`
  - `nerve import`
  - `nerve mine`
  - `nerve clusters`
  - `nerve learn`
  - `nerve evals gen`
  - `nerve replay`
  - `nerve patches list`
  - `nerve patches approve`
  - `nerve patches reject`
  - `nerve compile`
  - `nerve db`
- SQLite persistence through `better-sqlite3`.
- Migration for:
  - `tasks`
  - `compute_plans`
  - `context_packs`
  - `teachings`
  - `teaching_programs`
  - `traces`
  - `trace_events`
  - `failure_clusters`
  - `evals`
  - `patches`
  - `receipts`
  - `replay_summaries`
- Hashing utilities using canonical JSON and SHA-256.
- Zod schemas for core current IR:
  - `TaskEnvelope`
  - `ContextPack`
  - `TeachingObject`
  - `TeachingProgram`
  - `VerifierSpec`
  - `ComputePlan`
  - `Trace`
  - `FailureCluster`
  - `EvalCase`
  - `PatchCandidate`
  - `Receipt`
- `/health` endpoint.
- Current API verbs:
  - `POST /v1/compile-task`
  - `POST /v1/record-trace`
  - `POST /v1/generate-evals`
  - `POST /v1/learn`
  - `POST /v1/verify`
  - `POST /v1/replay`
  - `GET /v1/receipts/:id`
  - `GET /v1/clusters`
  - `GET /v1/patches`
  - `POST /v1/patches/:id/approve`
  - `POST /v1/patches/:id/reject`
- Optional bearer-token auth when `NERVE_TOKEN` is set.
- Receipt creation for current API verbs with input and output hashes.
- Heuristic risk classification for tasks.
- Deterministic model selection by risk, modality, and budget tier.
- Basic budget fields in `ComputePlan`.
- Context pack scaffolding from `context_refs`.
- Teaching selection based on scope keywords.
- Verifier selection and execution.
- Failure mining into coarse buckets such as schema hallucination, missing join, wrong aggregate, cost overrun, loop, refusal, and tool misuse.
- Learning flow that emits teachings and patch candidates.
- Eval generation from clusters.
- Replay runner with deterministic simulated model behavior.
- Seeded example traces and a scriptable demo.
- Existing tests for IR, planner, miner, replay, and verifiers.

## 4. Missing Features

For TokenOps, I could not find the following in the current project:

- OpenAI-compatible gateway endpoint `POST /v1/chat/completions`.
- OpenAI-compatible endpoint `POST /v1/responses`.
- OpenAI-compatible endpoint `POST /v1/embeddings`.
- Request normalizer for OpenAI-style chat/completion requests.
- OpenAI-compatible response adapter.
- Model provider abstraction matching `ModelProvider.complete(request)`.
- Mock provider for gateway calls.
- OpenAI provider adapter.
- Anthropic provider adapter.
- Gemini provider adapter.
- Ollama provider adapter.
- vLLM provider adapter.
- Exact cache implementation for normalized model requests.
- Semantic cache implementation.
- Prefix cache simulator.
- Tool-result cache.
- Context-block cache.
- Cache policy module with isolation and safety controls.
- `NormalizedRequest` type matching the TokenOps target.
- `RequestTrace` type matching the TokenOps target.
- `CacheEntry` type matching the TokenOps target.
- `BudgetPolicy` type matching the TokenOps target.
- `BenchmarkResult` type matching the TokenOps target.
- Workload profiler with TokenOps workload types.
- Request complexity estimator.
- Cacheability classifier.
- Provider router.
- TokenOps model router with downgrade/escalation decisions for gateway calls.
- Budget firewall that can block or downgrade model calls before execution.
- Quota policy.
- Agent loop limiter.
- AIS compute planner with foreground/background actions.
- Cheap-then-verify routing flow for gateway calls.
- Eval gate around cheap or cached responses in the serving path.
- Cost ledger with cost-by-user, cost-by-agent, cost-by-model, and savings reports.
- Trace ledger for every OpenAI-compatible request.
- Replay benchmark datasets named:
  - `benchmark/datasets/docs-qa.jsonl`
  - `benchmark/datasets/support-faq.jsonl`
  - `benchmark/datasets/coding-agent.jsonl`
  - `benchmark/datasets/long-prefix.jsonl`
  - `benchmark/datasets/agent-loop.jsonl`
  - `benchmark/datasets/tool-result-reuse.jsonl`
- Replay benchmark that compares baseline direct model calls vs optimized gateway execution.
- Could-have-been-cheaper analyzer.
- CLI commands:
  - `tokenops serve`
  - `tokenops replay <dataset>`
  - `tokenops replay --all`
  - `tokenops stats`
  - `tokenops trace <id>`
  - `tokenops cache stats`
  - `tokenops cache clear`
  - `tokenops analyze`
  - `tokenops analyze --trace <id>`
  - `tokenops budget status`
  - `tokenops demo`
- HTTP endpoints:
  - `GET /stats`
  - `GET /traces`
  - `GET /traces/:id`
  - `GET /benchmark/results`
  - `GET /cache/stats`
  - `POST /cache/clear`
  - `GET /budget/status`
- Pricing config at `config/pricing.json`.
- TokenOps docs under `docs/` beyond this inspection.
- Threat model specific to semantic caching, cross-user leakage, stale tool results, provider key leakage, and over-aggressive downgrade.
- Tests for the TokenOps gateway, cache layers, routing, budget firewall, AIS planner, analyzer, and OpenAI-compatible response shape.

## 5. Relevant Files With Paths

Current product docs:

- `README.md`
- `THESIS.md`
- `TRACTION.md`
- `VERIFICATION.md`
- `X_DEMO_SCRIPT.md`
- `research/api-spec.md`
- `research/architecture.md`
- `research/ir-schemas.md`
- `research/local-repo-map.md`
- `research/mvp-scope.md`
- `research/oss-reuse-plan.md`
- `research/wedge.md`

Current server/API:

- `apps/server/src/index.ts`
- `apps/server/package.json`

Current CLI:

- `apps/cli/src/index.ts`
- `apps/cli/bin/nerve`
- `apps/cli/package.json`

Current types and schemas:

- `packages/ir/src/schemas.ts`
- `packages/ir/src/ids.ts`
- `packages/ir/src/index.ts`
- `packages/ir/ir.test.ts`

Current persistence:

- `packages/store/src/db.ts`
- `packages/store/src/dao.ts`
- `packages/store/src/hash.ts`
- `packages/store/migrations/0001_init.sql`

Current planning:

- `packages/planner/src/index.ts`
- `packages/planner/planner.test.ts`

Current mining/learning/evals:

- `packages/miner/src/index.ts`
- `packages/miner/miner.test.ts`
- `packages/learner/src/index.ts`

Current replay:

- `packages/replay/src/index.ts`
- `packages/replay/replay.test.ts`

Current verification:

- `packages/verifiers/src/index.ts`
- `packages/verifiers/verifiers.test.ts`

Current importers:

- `packages/importers/src/index.ts`

Current SDK:

- `packages/sdk-ts/src/index.ts`

Current demo and examples:

- `scripts/demo.sh`
- `examples/openai-traces/traces_01.jsonl`
- `examples/openai-traces/traces_02.jsonl`
- `examples/openai-traces/traces_03.jsonl`
- `examples/openai-traces/traces_04.jsonl`
- `examples/openai-traces/traces_05.jsonl`
- `examples/sdk-demo/agent.ts`
- `examples/sdk-demo/task.json`

## 6. What Can Be Reused

The existing project is worth evolving rather than replacing.

Reusable directly:

- pnpm monorepo structure
- TypeScript config
- Vitest setup
- Fastify server wiring
- CLI conventions
- SQLite store pattern
- canonical JSON hashing
- ULID-style IDs
- receipt pattern
- trace/event persistence pattern
- deterministic replay testing style
- seeded demo philosophy
- model table and risk/modality-based planning ideas
- existing verifier interface and grader functions
- research docs and positioning around compile, learn, replay, receipts

Reusable with extension:

- `ComputePlan` should be extended or complemented with TokenOps serving-path `ComputePlan` fields.
- `Trace` should be complemented by `RequestTrace` for model-call gateway traces.
- `compileTask` can become one input into AIS planning, but should not be the only serving-time path.
- Current replay can remain for patch/eval learning while a new benchmark runner is added for baseline-vs-optimized gateway replay.
- Current receipt table can remain while a request trace/cost ledger is added.
- Current Fastify app can host TokenOps routes instead of introducing another server framework.
- Current CLI can expose both legacy `nerve` commands and new `tokenops` commands during transition.

## 7. What Should Be Rewritten

Rewrite or create new modules rather than stretching current modules too far:

- Serving path for `/v1/chat/completions`.
- OpenAI request normalization and response adaptation.
- Provider abstraction and provider adapters.
- Cache/reuse layer.
- Workload profiler.
- Cacheability classifier.
- Request complexity estimator.
- Budget firewall for inference calls.
- TokenOps model/provider router for normalized requests.
- AIS compute planner for foreground/background serving actions.
- Cheap-then-verify flow.
- Could-have-been-cheaper analyzer.
- Benchmark datasets and baseline-vs-optimized replay runner.

The current `planner` package is task/compiler-oriented. It should not become a giant gateway package. TokenOps should add focused packages/modules and let `planner` remain the compile-task subsystem.

## 8. What Should Be Kept Simple

Keep the first TokenOps implementation deliberately local and deterministic:

- Use Fastify rather than adding another HTTP framework.
- Use SQLite through the existing `better-sqlite3` pattern.
- Use in-process cache implementations first.
- Use lexical semantic similarity first; do not add vector DB infrastructure yet.
- Use mock provider as the default execution engine.
- Use adapter stubs for OpenAI, Anthropic, Gemini, Ollama, and vLLM where full implementation is not needed for the proof.
- Use estimated token counts and configurable pricing, not authoritative billing claims.
- Use heuristic workload classification first.
- Use heuristic verifier/mock eval gate first.
- Keep benchmark datasets small, readable, and deterministic.
- Keep the CLI output readable before adding UI.
- Do not build a frontend in the first pass.

## 9. Biggest Architecture Risks

1. Product boundary drift.

   The existing project says “not a gateway.” TokenOps requires a gateway. The repo needs a clear compatibility story: keep `nerve` compile/learn/replay as the learning brain, and add TokenOps gateway as the serving-time control plane.

2. Cache safety and cross-user leakage.

   Exact cache and semantic cache must include user/agent isolation policy. Semantic cache must be disabled by default for private, risky, current-state, code-modification, and security-sensitive requests.

3. Over-aggressive model downgrade.

   The router must produce reasons and trace the difference between requested model, selected model, downgrade, escalation, and verifier use. Cheap routing without visible reason codes will make the product untrustworthy.

4. Replay benchmark credibility.

   The proof should avoid hardcoded savings. Baseline-vs-optimized replay must count model calls, cache hits, token estimates, cost estimates, and wrong-cache incidents from actual gateway decisions.

5. Type bifurcation.

   Current `TaskEnvelope`/`ComputePlan` types are not the same as the desired `NormalizedRequest`/`RequestTrace`/`ComputePlan`. The next implementation should avoid name confusion by either versioning types or using clear TokenOps-specific names.

6. Store migration sprawl.

   The current migration is a single SQL file. Adding many TokenOps tables directly to `0001_init.sql` would be messy. Add a new migration or a clean migration runner before adding gateway ledgers and caches.

7. CLI naming transition.

   The repo is `nerve`, but code/docs should use TokenOps unless the existing strong name is intentionally retained. During transition, expose `tokenops` without breaking existing `nerve` commands.

8. Provider-key safety.

   Real provider adapters must not log API keys or raw auth headers. The default demo should remain keyless through mock provider.

9. Tests lagging behind architecture.

   The current tests cover v0.1 compile/replay behavior, not gateway behavior. Gateway, cache, routing, budget, AIS, and analyzer tests need to become the real proof.

## 10. Recommended Implementation Order

Recommended order from this repo state:

1. Add TokenOps architecture docs and transition plan.
2. Add TokenOps type layer for `NormalizedRequest`, `RequestTrace`, `ComputePlan`, `CacheEntry`, `BudgetPolicy`, and `BenchmarkResult`.
3. Add pricing config and token/cost estimator.
4. Add OpenAI-compatible request normalizer and response adapter.
5. Add mock provider and provider interface.
6. Add `/v1/chat/completions` endpoint using mock provider, with OpenAI-compatible response shape.
7. Add request trace ledger for gateway calls.
8. Add exact cache with stable normalized hashing and tests.
9. Add baseline-vs-optimized replay benchmark runner and initial datasets.
10. Add prefix cache simulator.
11. Add workload profiler, complexity estimator, and cacheability classifier.
12. Add semantic cache for safe workloads only.
13. Add tool-result cache and context-block cache.
14. Add model router and provider router for gateway calls.
15. Add budget firewall and quota policy.
16. Add AIS compute planner over cache, policy, routing, and verifier decisions.
17. Add cheap-then-verify flow and eval gate.
18. Add agent loop limiter.
19. Add could-have-been-cheaper analyzer.
20. Add TokenOps CLI commands while preserving existing `nerve` commands.
21. Add HTTP read endpoints for stats, traces, cache, benchmark results, and budget.
22. Add full docs:
    - `docs/architecture.md`
    - `docs/cache-model.md`
    - `docs/routing-model.md`
    - `docs/ais.md`
    - `docs/budget-policy.md`
    - `docs/replay-benchmark.md`
    - `docs/threat-model.md`
    - `docs/quickstart.md`
    - `docs/provider-adapters.md`
    - `docs/could-have-been-cheaper.md`
23. Update README to position TokenOps as the adaptive inference control plane.
24. Run typecheck, tests, gateway smoke test, replay benchmark, and demo.

The first implementation milestone should not delete the existing compile/learn/replay loop. It should add the missing serving-time control plane and reuse the existing planner/replay/receipt foundation where it fits.
