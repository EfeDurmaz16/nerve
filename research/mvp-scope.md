# nerve v0.1 MVP Scope

The MVP exists to demonstrate one closed loop on one laptop in 90 seconds: import failing traces → see clusters → generate evals → propose a patch → replay shows measurable improvement. Nothing else matters for v0.1.

---

## What ships in v0.1

### Core packages

- **`packages/ir/`** — Zod schemas from `ir-schemas.md`, no runtime logic. Exports `TaskEnvelope`, `ComputePlan`, etc., plus type guards and `parseOrThrow`. Published-style internal package (workspace dep).
- **`packages/store/`** — better-sqlite3 wrapper. Migrations in `migrations/0001_init.sql` (creates `tasks`, `compute_plans`, `context_packs`, `teaching_programs`, `teachings`, `traces`, `trace_events`, `failure_clusters`, `evals`, `patches`, `receipts`). DAO functions per table. No ORM. WAL mode on.
- **`packages/planner/`** — implements `compile-task`. Submodules: `classify.ts` (LLM call), `context.ts` (BM25 + cosine over a local FAISS-lite or `sqlite-vss`), `teachings.ts` (scope-match + rank), `model_select.ts` (deterministic table), `budget.ts`, `verifiers.ts`, `fallback.ts`. Each submodule has a `heuristic` and `llm` mode; v0.1 ships heuristic for everything except `classify.ts` and `context.ts`.
- **`packages/miner/`** — `cluster.ts` (embedding + agglomerative on failure events), `label.ts` (LLM names the cluster), `signature.ts` (deterministic hash for dedup). Runs synchronously inside `record-trace` for v0.1; queue worker comes later.
- **`packages/learner/`** — `teach.ts` (cluster → TeachingObjects), `patch.ts` (cluster → PatchCandidate). Both LLM-backed.
- **`packages/replay/`** — `runner.ts` executes evals under baseline and patch, aggregates delta.
- **`packages/verifiers/`** — built-in `schema` (Zod/JSONSchema), `regex`, `exec` (sandboxed Node VM), `llm_judge`. Plugin interface for custom verifiers.
- **`packages/importers/`** — `openai_jsonl.ts`, `langsmith.ts` (best-effort), `otel.ts` (basic spans → events). Converts to native Trace.

### Apps

- **`apps/server/`** — Fastify HTTP server exposing the 6 verbs from `api-spec.md`. Single process, single SQLite file at `~/.nerve/nerve.db`. Bearer-token auth from `NERVE_TOKEN`.
- **`apps/cli/`** — `nerve` command. Subcommands: `init`, `import <file>`, `compile`, `mine`, `learn`, `evals gen`, `replay`, `patches list`, `patches approve <id>`, `serve`, `db`.

### Examples

- **`examples/openai-traces/`** — 50 hand-curated JSONL traces from a SQL-generation agent, with deliberate failure patterns (3 clusters: schema hallucination, missing JOIN, wrong aggregate function).
- **`examples/sdk-demo/`** — 30-line agent in `examples/sdk-demo/agent.ts` that calls `compile-task` → runs → `record-trace`.

### SDK

- **`packages/sdk-ts/`** — typed client for the 6 verbs. Wraps `fetch`, handles idempotency keys, re-exports IR types.

---

## What is explicitly OUT of v0.1

- Authentication beyond a single bearer token. No users, no orgs, no RBAC.
- Multi-tenancy. One SQLite file, one process, one team.
- Hosted SaaS. Self-host only. No billing, no cloud control plane.
- UI dashboard. No React, no web frontend. CLI + JSON only.
- Gateway/proxy mode (intercepting LLM calls transparently). Agents call nerve explicitly.
- Distributed workers, queues (BullMQ/Temporal), Postgres, Redis.
- Streaming responses (SSE/WebSocket). Everything is request/response.
- Multi-model routing across providers in one plan (e.g. mid-call switch). One primary, ordered fallbacks.
- Production observability (Prometheus, OTel export). Logs to stderr only.
- Fine-tuning, RFT, LoRA adapters. nerve learns by changing *policy and context*, not weights.
- Continuous learning loop (auto-promote patches). Every patch requires `patches approve`.

---

## The 3 modes

### A. Offline audit
**Use:** "Here are 50 traces from my agent. What's wrong?"
**Flow:** `nerve import examples/openai-traces/*.jsonl` → store + auto-mine. `nerve patches list` shows nothing yet (no learn run). `nerve mine --report` prints clusters. `nerve learn --all` → teachings + patches. `nerve evals gen --all` → eval cases. End state: a populated DB with clusters, evals, and proposed patches. Zero agent integration required.

### B. Runtime compile
**Use:** Agent is live and wants a compute plan per task.
**Flow:** Agent code calls `sdk.compileTask(envelope)` → receives ComputePlan with model, context, teachings, verifiers, fallbacks → agent executes → calls `sdk.recordTrace(trace)`. Over time, mined failures feed back into the planner via approved patches.

### C. Replay
**Use:** "Did this patch actually help?"
**Flow:** `nerve replay --patch p_123 --evals all` → produces baseline vs. candidate metrics. `nerve patches approve p_123` flips the patch to `live`; next `compile-task` reflects it. Reproducible because eval inputs are stored and grader configs are pinned.

---

## The 90-second demo path

```bash
# 0-10s: init
nerve init                                # creates ~/.nerve/nerve.db, prints token
nerve serve &                             # starts API on :7777

# 10-30s: import failing traces
nerve import examples/openai-traces/*.jsonl
#   → "Imported 50 traces. 31 failures. Mining…"
#   → "Found 3 failure clusters: schema_hallucination(14), missing_join(11), wrong_agg(6)"

# 30-50s: learn
nerve learn --all
#   → "Generated 7 teachings, 3 patch candidates."
nerve evals gen --all
#   → "Generated 12 eval cases across 3 clusters."

# 50-75s: replay
nerve replay --patch all --evals all --sample 30
#   → baseline pass_rate=0.42  candidate pass_rate=0.83  Δ=+0.41
#   → cost  -18%   latency p50  +6%

# 75-90s: approve and compile a new task
nerve patches approve p_001 p_002 p_003
curl -X POST localhost:7777/v1/compile-task -d @examples/sdk-demo/task.json
#   → returns a ComputePlan that visibly includes 3 teachings + verifier from the patches
```

The reviewer sees: failures-in, plan-with-teachings-out, measurable delta, audit receipt at each step.

---

## Acceptance criteria for "demo-ready"

1. `nerve import examples/openai-traces/*.jsonl` ingests 50 JSONL traces in under 5 seconds.
2. Miner produces **≥ 3 distinct FailureClusters** with non-overlapping `signature`s on the curated example set.
3. `learn --all` produces **≥ 1 TeachingObject and ≥ 1 PatchCandidate per cluster**, each with non-empty `rationale`.
4. `evals gen --all` produces **≥ 1 EvalCase per cluster** with a valid grader config that runs end-to-end.
5. `replay` produces a JSON report where **candidate `pass_rate` exceeds baseline by ≥ 0.20** on the seeded example, with zero regressions exceeding 5% of eval count.
6. `compile-task` on a task whose intent matches an approved cluster returns a ComputePlan whose TeachingProgram contains the relevant teaching (provable by `teaching_id` match).
7. Every API call returns an `X-Receipt-Id`; `GET /v1/receipts/:id` returns the Receipt with `inputs_hash`, `outputs_hash`, cost, latency.
8. Total install-to-demo time on a clean Mac with `node >=20` is under 3 minutes.
9. All 6 endpoints have at least one integration test in `apps/server/test/`; IR schemas have property tests for round-trip parse.
10. `nerve --help` and every subcommand `--help` works and references the matching API verb.

---

## Repo layout

```
nerve/
├── apps/
│   ├── server/
│   │   ├── src/{routes,middleware,index.ts}
│   │   └── test/
│   └── cli/
│       ├── src/{commands,index.ts}
│       └── bin/nerve
├── packages/
│   ├── ir/                  # Zod schemas, types
│   ├── store/               # sqlite DAOs + migrations
│   ├── planner/             # compile-task internals
│   ├── miner/               # cluster + label
│   ├── learner/             # teach + patch
│   ├── replay/              # runner + delta
│   ├── verifiers/           # built-ins + interface
│   ├── importers/           # openai/langsmith/otel
│   └── sdk-ts/              # typed client
├── examples/
│   ├── openai-traces/       # 50 curated JSONL files + README
│   └── sdk-demo/            # minimal agent calling nerve
├── research/                # this directory (design docs)
├── scripts/                 # dev tooling (seed.ts, demo.sh)
├── package.json             # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

Workspace tool: **pnpm**. Build: **tsup** per package (ESM + d.ts). Test: **vitest**. Lint: **biome**. No bundler at the app level — Node 20+ runs ESM natively.
