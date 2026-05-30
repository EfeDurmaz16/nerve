# TokenOps / nerve

> **Adaptive inference control plane for AI apps and agents.**

TokenOps caches, routes, budgets, verifies, traces, and replays model calls before they burn compute. The existing repo name is still `nerve`; the serving-time control plane added here uses TokenOps naming.

Sardis is policy before economic spend. TokenOps is policy before compute spend.

## Why now

Agents no longer make one model call. They run loops, resend huge context, retry tools, call overpowered models, and burn compute invisibly. Every serious agent runtime needs a compute control plane:

- cache before recompute
- route before escalate
- verify before continue
- budget before inference
- evidence after execution

## OpenAI-Compatible Gateway

Start the local gateway:

```bash
TOKENOPS_PORT=8787 pnpm --filter @nerve/server start
```

Run against a real Groq LLM:

```bash
GROQ_API_KEY=... \
TOKENOPS_PROVIDER=groq \
GROQ_MODEL=llama-3.3-70b-versatile \
TOKENOPS_PORT=8787 \
pnpm --filter @nerve/server start
```

Point OpenAI-compatible clients at:

```bash
OPENAI_BASE_URL=http://localhost:8787/v1
```

Smoke test:

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"docs quickstart"}]}'
curl -sS -X POST http://127.0.0.1:8787/v1/responses \
  -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","input":"docs quickstart"}'
curl -sS -X POST http://127.0.0.1:8787/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"model":"text-embedding-3-small","input":["TokenOps cache policy","Adaptive inference control plane"],"dimensions":32}'
```

Implemented endpoints:

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `GET /v1/models`
- `GET /health`
- `GET /ready`
- `GET /stats`
- `GET /traces`
- `GET /traces/:id`
- `POST /replay`
- `GET /benchmark/results`
- `GET /cache/stats`
- `POST /cache/clear`
- `GET /budget/status`
- `POST /policy/simulate`
- `GET /rate-limit/status`
- `GET /runtime/stats`
- `GET /analyze`
- `GET /routing/policy`
- `GET /providers/health`

`POST /replay` runs local benchmark datasets through the baseline-vs-optimized TokenOps runner and stores results in SQLite.

## Architecture

```text
App / Agent / Coding Tool
  -> OpenAI-Compatible Gateway
  -> Request Normalizer
  -> Workload Profiler
  -> Policy + Budget Firewall
  -> Cache / Reuse Layer
  -> AIS Compute Planner
  -> Model / Provider Router
  -> Verifier / Eval Gate
  -> Trace + Cost Ledger
  -> Replay Benchmark
```

TokenOps packages live under `packages/core`, `packages/gateway`, `packages/cache`, `packages/profiler`, `packages/router`, `packages/policy`, `packages/ais`, `packages/providers`, `packages/ledger`, `packages/verifier`, and `packages/benchmark`.

## CLI

The repo still ships the legacy `nerve` CLI. TokenOps commands are available through the same entrypoint today:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay benchmark/datasets/docs-qa.jsonl --persist
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts export ./tokenops-snapshot.json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts import ./tokenops-snapshot.json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts reconcile ./provider-usage.jsonl
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts traces export --format otel --out ./tokenops-spans.jsonl
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts prune --keep-traces 1000 --keep-benchmarks 100 --keep-idempotency 1000
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts load --requests 40 --concurrency 10 --duplicate-ratio 0.5
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts load-shedding
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts batch --requests 32 --batch-size 8
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts failover --requests 12
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput mock --requests 24 --concurrency 6
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq --requests 4 --concurrency 2
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof --include-groq
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify readiness --json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts doctor
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts demo
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts demo --json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts serve
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts gateway smoke --url http://127.0.0.1:8787
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare groq
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare openai
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval --dataset benchmark/verifier/basic.jsonl
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify routing
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts cache eval
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts cache eval --sweep --thresholds 0.2,0.3,0.5
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing policy
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing slo
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing slo-benchmark
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers health
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers attempts
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts policy simulate --daily-budget-usd 2 --max-request-cost-usd 0.01
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts smoke ollama
```

Once linked/installed, `apps/cli/bin/tokenops` exposes:

- `tokenops serve`
- `tokenops replay <dataset>`
- `tokenops replay --all`
- `tokenops replay <dataset> --persist`
- `tokenops export <file>`
- `tokenops import <file>`
- `tokenops reconcile <provider-usage.jsonl>`
- `tokenops traces export --format otel [--out file]`
- `tokenops prune --keep-traces <n> --keep-benchmarks <n> --keep-idempotency <n>`
- `tokenops load`
- `tokenops load-shedding`
- `tokenops batch`
- `tokenops failover`
- `tokenops throughput [mock|ollama|groq]`
- `tokenops proof`
- `tokenops doctor`
- `tokenops verify readiness [--json]`
- `tokenops gateway smoke [--url http://127.0.0.1:8787] [--admission]`
- `tokenops stats`
- `tokenops trace <id>`
- `tokenops cache stats`
- `tokenops cache clear`
- `tokenops cache eval [dataset] [--sweep --thresholds 0.2,0.3,0.5]`
- `tokenops analyze`
- `tokenops analyze --trace <id>`
- `tokenops budget status`
- `tokenops policy simulate --daily-budget-usd <usd> --max-request-cost-usd <usd>`
- `tokenops routing policy`
- `tokenops routing slo`
- `tokenops routing slo-benchmark`
- `tokenops routing arbitrage --provider <name> --candidates groq,openai,mock`
- `tokenops providers health`
- `tokenops providers attempts`
- `tokenops verify eval`
- `tokenops verify eval --dataset <jsonl>`
- `tokenops verify routing [dataset]`
- `tokenops compare groq`
- `tokenops compare openai`
- `tokenops smoke ollama`
- `tokenops demo [--json]`

## Benchmark Example

```text
Dataset: long-prefix.jsonl
Baseline: requests=2 model_calls=2 estimated_cost=$0.019
Optimized: model_calls=2 estimated_cost=$0.00409 cost_reduction=78.5%
Cache: exact=0.0% semantic=0.0% tool=0.0% context=50.0%
Routing: downgraded=100.0% verifier_escalation=0.0%
Tokens: input_saved=0 output_saved=994 prefix_eligible=708
Latency: p50=1ms p95=1ms
Wrong-cache incidents: 0
```

Run:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
```

Runtime load benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts load \
  --requests 40 \
  --concurrency 10 \
  --duplicate-ratio 0.5 \
  --provider-latency-ms 25
```

This stresses the local inference runtime and reports provider calls avoided by in-flight request coalescing, p50/p95 latency, scheduler queue stats, and circuit state.

Micro-batching benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts batch \
  --requests 32 \
  --batch-size 8 \
  --batch-window-ms 5 \
  --per-batch-overhead-ms 20 \
  --per-item-latency-ms 2
```

This simulates provider-side batching economics: fixed per-call overhead plus per-item work. It reports batch count, largest batch, average batch size, baseline wall time, batched wall time, and estimated latency reduction.

Provider failover benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts failover \
  --requests 12 \
  --primary-failures-before-success 12 \
  --circuit-failure-threshold 2
```

This proves the local inference runtime opens the primary provider circuit after repeated failures, bypasses the broken provider, and recovers every request through a fallback provider. The report includes primary calls, fallback calls, circuit-rejected requests, failed responses, and runtime circuit state.

Provider throughput benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput mock \
  --requests 24 \
  --concurrency 6 \
  --provider-latency-ms 5

TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput ollama \
  --requests 8 \
  --concurrency 2 \
  --model llama3.2

TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq \
  --requests 4 \
  --concurrency 2 \
  --model llama-3.3-70b-versatile
```

This measures provider calls, total input/output tokens, output tokens/sec, total tokens/sec, p50/p95 latency, errors, and runtime scheduler/circuit stats. The Ollama and Groq paths are availability-aware: if `ollama serve` or `GROQ_API_KEY` is unavailable, the command returns a skipped report instead of failing the benchmark run.

Product-readiness proof report:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof --include-groq
```

This writes:

- `docs/experiments/tokenops-product-readiness-report.json`
- `docs/experiments/tokenops-product-readiness.md`

The report combines replay savings, runtime coalescing, micro-batching, mock throughput, optional live Groq throughput, pass/fail gates, and known gaps.

Product demo summary:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts demo
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts demo --json
```

The TokenOps demo summarizes replay savings, exact/semantic cache safety,
provider SLO routing, provider arbitrage, verifier escalation, policy blocks,
AIS foreground/background planning, runtime priority scheduling, load shedding,
and could-have-been-cheaper analyzer output.

HTTP gateway smoke, against a running gateway. This checks `/ready`, `/v1/models`, OpenAI-compatible chat shape, exact cache reuse, and runtime stats:

```bash
TOKENOPS_PORT=8787 pnpm --filter @nerve/server start
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts gateway smoke --url http://127.0.0.1:8787
```

For HTTP-level admission-control proof, start with a constrained local runtime
and include `--admission`:

```bash
TOKENOPS_PROVIDER=mock \
TOKENOPS_MOCK_DELAY_MS=40 \
TOKENOPS_MAX_CONCURRENT_INFERENCE=1 \
TOKENOPS_MAX_INFERENCE_QUEUE=1 \
pnpm --filter @nerve/server start

TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts gateway smoke \
  --url http://127.0.0.1:8787 \
  --admission
```

Safety/eval gates:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts cache eval
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts cache eval --sweep --thresholds 0.2,0.3,0.5
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify routing
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval --dataset benchmark/verifier/basic.jsonl
```

`cache eval` runs adversarial semantic-cache cases and reports false unsafe hits and safe misses. The sweep mode compares thresholds and recommends the safest threshold that preserves safe reuse on the local corpus. `verify routing` runs cheap-then-verify regression cases and reports expected escalations, false escalations, and missed escalations.

Provider SLO routing benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing slo-benchmark
```

This generates synthetic provider traces where Groq violates the local SLO window and mock remains eligible, then proves the router reroutes from `groq` to `mock`.

Local setup doctor:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts doctor
```

This reports git/remote status, `.env` ignore safety, provider configuration presence, proof readiness, and whether the gateway port is already occupied. It never prints provider secret values.

Before pushing or tagging, run the checklist in `docs/release-checklist.md`.

## Difference From LiteLLM

LiteLLM abstracts providers.

TokenOps controls compute spend. It decides whether the call should happen at all, whether cache/reuse is safe, whether a cheaper model is enough, whether a stronger verifier is required, and what evidence should be written afterward.

## Difference From Langfuse/LangSmith

Langfuse and LangSmith observe traces.

TokenOps acts before compute is spent. It can serve cache, downgrade, block, verify, and then log the decision for replay.

## Status

Production-like:

- OpenAI-compatible chat completions endpoint with streaming chunk support
- minimal OpenAI-compatible non-streaming Responses endpoint
- deterministic normalizer and stable request hash
- SQLite-backed exact cache with user/agent isolation
- SQLite-backed semantic cache with safety classifier
- prefix cache simulator
- SQLite-backed tool-result and context-block cache primitives
- workload profiler
- model router
- budget firewall
- AIS compute plan
- request trace and cost ledger
- SQLite-backed provider attempt ledger for fallback/retry debugging
- SQLite-backed idempotency records for retry-safe chat completions, including SSE replay
- snapshot import/export for TokenOps traces and benchmark results
- provider usage JSONL reconciliation against the trace ledger
- OpenTelemetry-style JSONL trace export
- retention pruning for local TokenOps traces, benchmark results, and idempotency records
- benchmark datasets and replay runner
- mock provider
- Groq provider over OpenAI-compatible HTTP
- OpenAI provider over OpenAI-compatible HTTP
- deterministic local `/v1/embeddings` compatibility for RAG and semantic-cache experiments
- Ollama local provider over `/api/chat`
- provider fallback chains such as `TOKENOPS_PROVIDER=groq,ollama,mock`
- trace-derived adaptive routing policy endpoint and optional runtime application
- verifier pass-rate gated adaptive routing
- provider health scoring from traces
- trace-derived provider arbitrage across configured provider candidates
- verifier eval harness with confusion metrics
- cheap-then-verify routing benchmark with false/missed escalation counts
- semantic-cache safety eval with adversarial cache-reuse fixtures
- semantic-cache threshold sweep for local safety/recall tradeoff checks
- env-configurable max request cost, daily budget, daily user/agent quota, per-minute rate limit, and agent loop limiter
- budget policy shadow mode for would-block rollout analysis
- provider failure traces with redaction for common API key and authorization formats
- inference runtime with concurrency admission, priority-aware bounded queueing, provider circuit breaker, provider timeout aborts, and in-flight request coalescing
- local background task queue for AIS verification, context, and trace-maintenance work
- rolling SLO routing policy from local traces, with error-rate, p95 latency, and average cost thresholds
- optional provider arbitrage with `TOKENOPS_PROVIDER_ARBITRAGE=1` and `TOKENOPS_PROVIDER_CANDIDATES=groq,openai,mock`
- SLO rerouting benchmark that proves unhealthy providers are avoided when an eligible fallback exists
- first-class `providerLatencyMs` in TokenOps request traces for SLO routing and provider health
- tests and typecheck

Prototype/mock:

- Anthropic/Gemini/vLLM adapters are scaffolded
- semantic similarity is lexical
- embeddings are deterministic local hashed vectors, not provider-grade embedding models
- request traces and benchmark results are SQLite-backed
- pricing is configurable estimate data, not billing truth
- verifier gate supports heuristic and model-backed judging, but production quality still depends on eval coverage
- benchmark datasets are small deterministic fixtures
- rate limiting is local in-memory per gateway process
- circuit breaker and coalescing are local per gateway process; distributed coordination is future work
- idempotency is implemented for non-streaming chat completions and generated SSE stream replay; token-level upstream streaming remains future work

Roadmap:

- token-level streaming support with real provider deltas
- fuller Anthropic/Gemini/vLLM adapters
- provider-backed or production embedding models for semantic cache
- redaction policy hooks
- larger eval-backed cache safety corpus
- direct Langfuse export adapter
- signed receipts via FIDES-style evidence chain

---

## Legacy nerve loop

The original `nerve` compile/learn/replay loop remains below.

> **The inference compiler agents call before they call a model.**

Agents should not hardcode `model = "claude-opus-4-7"`. They should HTTP `POST /v1/compile-task` with `{task, budget, context}` and get back a **ComputePlan** — which model, what context, which verifier, when to fall back, what budget to respect, and which prior lessons apply — that gets better every week because traces and corrections feed back into the compiler.

Like DSPy, but online, agent-facing, and provider-agnostic.

---

## Why this exists

Every other LLM tool is human-facing:

| Tool | Category | What it does |
|---|---|---|
| OpenRouter, Helicone, LiteLLM, Portkey, Vercel AI Gateway | **Gateways** | Route a call between providers. |
| Langfuse, LangSmith, Braintrust, Arize Phoenix | **Observability / Eval** | Trace + experiment workbench for humans. |
| DSPy | **Compiler (offline)** | Compile prompts via metric optimization — Python lib for researchers. |
| LangGraph, OpenAI Agents SDK, Mastra | **Frameworks** | Compose agents into graphs. |
| Mem0, vector DBs | **Memory** | Store and retrieve memories. |
| E2B, Daytona, Modal | **Sandboxes** | Execute code safely. |

**Nothing sits before the model call, at runtime, exposing planning and learning as agent-facing verbs.** That is the seam.

nerve sits there. It does not terminate provider keys, does not mark up tokens, does not ship a dashboard. It tells the agent *what* to call — the agent (or LiteLLM/OpenRouter/Vercel) does the calling.

---

## The closed loop

```
task   ─► /compile-task   ─► ComputePlan (model + context + teachings + verifier + budget + fallback)
exec   ─► /record-trace   ─► Trace (events, cost, latency, outcome)
trace  ─► mine            ─► FailureCluster
cluster─► /learn          ─► TeachingObject + PatchCandidate
cluster─► /generate-evals ─► EvalCase
patches × evals ─► /replay ─► before/after delta ─► human approve ─► live policy
```

Every approved patch is reflected in the next `/compile-task` response. **The compiler gets smarter with usage.**

---

## Quickstart (90 seconds, no API keys needed)

For TokenOps, the fastest proof is:

```bash
pnpm install
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts demo --json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof
```

Start the OpenAI-compatible gateway when you want to connect a client:

```bash
TOKENOPS_PORT=8787 pnpm --filter @nerve/server start
```

Then use:

```bash
OPENAI_BASE_URL=http://127.0.0.1:8787/v1
```

The legacy Nerve learning-loop demo is still available:

```bash
pnpm install
pnpm demo
```

The demo:
1. seeds `~/.nerve/nerve.db` and starts the API on `:7777`,
2. imports 50 OpenAI-style JSONL traces from `examples/openai-traces/`,
3. mines 3 failure clusters (`schema_hallucination`, `missing_join`, `wrong_agg`),
4. runs `learn` → 7 teachings, 3 patch candidates,
5. runs `generate-evals` → 9 eval cases,
6. runs `replay` → baseline `pass_rate=0.67` → candidate `pass_rate=1.0`, **+0.333 with zero regressions**,
7. approves the patches, POSTs a fresh task to `/v1/compile-task`, and returns a ComputePlan that visibly contains the 3 approved teachings.

Total wall-clock on a clean Mac: ~8 seconds.

```text
baseline     pass_rate=0.667  cost=$0.0019  p50=356ms
candidate    pat_…ATFC3T8S8R  pass_rate=1.0 (+0.333)  cost=$0.0019 (Δ$0.00)  regressions=0
candidate    pat_…6S0HVPNR4G  pass_rate=1.0 (+0.333)  cost=$0.0019 (Δ$0.00)  regressions=0
candidate    pat_…PTD62KBV6T  pass_rate=1.0 (+0.333)  cost=$0.0019 (Δ$0.00)  regressions=0
```

---

## CLI

```bash
nerve init                                # create ~/.nerve, print token
nerve serve                               # start API on :7777
nerve import <file|glob>                  # ingest JSONL traces
nerve mine                                # cluster failures
nerve clusters                            # list clusters
nerve learn [--cluster <id>]              # generate teachings + patch candidates
nerve evals gen [--cluster <id>]          # generate eval cases
nerve replay --patch <id|all> [--sample N]
nerve patches list [--status proposed|live]
nerve patches approve <id> [<id>...]
nerve compile <file.json>                 # compile a TaskEnvelope JSON file
nerve db                                  # print db path + counts
```

---

## HTTP API — six verbs

All requests/responses are JSON. Bodies are typed against the IR in `packages/ir/`. Every response carries `X-Receipt-Id`; the receipt is retrievable at `GET /v1/receipts/:id`.

### `POST /v1/compile-task`

Turn an agent's intent into a budget-aware compute plan.

```bash
curl -X POST http://127.0.0.1:7777/v1/compile-task \
  -H 'content-type: application/json' \
  -d '{
    "task": {
      "schema_version": "0.1",
      "task_id": "tsk_demo_1",
      "agent_id": "sql_agent",
      "intent": "Generate a SQL query that joins users and orders…",
      "modality": "code",
      "risk_class": "medium",
      "inputs": { "schema": { "users": ["id","name"], "orders": ["id","user_id"] } },
      "budget_hint": { "max_usd": 0.02, "max_latency_ms": 5000 },
      "context_refs": ["schema.users","schema.orders"],
      "created_at": "2026-05-24T00:00:00Z"
    }
  }'
```

Returns `{plan, context_pack, teaching_program, receipt_id}`.

### `POST /v1/record-trace`

Persist execution evidence. Triggers async mining.

### `POST /v1/generate-evals`

Cluster → regression `EvalCase`s.

### `POST /v1/learn`

Cluster → `TeachingObject`s + `PatchCandidate`s (status `proposed`).

### `POST /v1/verify`

Run the verifier suite from a plan (or ad-hoc) against an output.

### `POST /v1/replay`

Patches × evals → before/after delta. Output: `{baseline, candidates: [{patch_id, pass_rate, cost_usd, delta, regressions}], replay_id}`.

### Auxiliary

- `GET /v1/clusters` — list failure clusters
- `GET /v1/patches?status=proposed|approved|rejected|live`
- `POST /v1/patches/:id/approve`
- `GET /v1/receipts/:id`

---

## SDK (TypeScript)

TokenOps gateway client:

```ts
import { TokenOpsClient } from "@nerve/sdk-ts";

const tokenops = new TokenOpsClient({ base_url: "http://127.0.0.1:8787" });

const completion = await tokenops.chatCompletions(
  {
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Explain the cache policy." }],
  },
  { idempotencyKey: "request-123" },
);

console.log(completion.choices[0].message.content);
console.log(await tokenops.stats());
console.log(await tokenops.cacheStats());
```

`TokenOpsClient` accepts either a gateway root URL such as `http://localhost:8787`
or an OpenAI-style base URL such as `http://localhost:8787/v1`. It also exposes
`chatCompletionsStream`, `budgetStatus`, `traces`, `trace`, and `policySimulate`
helpers for local control-plane workflows.

Legacy Nerve compiler client:

```ts
import { NerveClient } from "@nerve/sdk-ts";

const nerve = new NerveClient({ base_url: "http://127.0.0.1:7777" });
const { plan, teaching_program } = await nerve.compileTask(envelope);

// ...agent runs plan against any provider/gateway, captures a trace...

await nerve.recordTrace(trace);
```

A complete 30-line agent: `examples/sdk-demo/agent.ts`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       agent (your code, your framework)              │
└────────────────┬──────────────────────────────────┬──────────────────┘
                 │ /compile-task                    │ /record-trace
                 ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ apps/server (Fastify, single process)                                  │
│  ├─ planner    classify→context→teachings→model→verifiers→budget→…    │
│  ├─ miner      cluster failures by signature                          │
│  ├─ learner    cluster → TeachingObject + PatchCandidate              │
│  ├─ verifiers  schema / regex / exec / llm_judge                      │
│  ├─ replay     patches × evals → delta                                │
│  └─ store      better-sqlite3 (WAL) — one file at ~/.nerve/nerve.db   │
└────────────────────────────────────────────────────────────────────────┘
```

Every component is a workspace package under `packages/`. The server is a thin Fastify wrapper that wires them up. The CLI is a parallel surface over the same internal functions.

### Repo layout

```
nerve/
├── apps/
│   ├── server/      — Fastify HTTP service, six verbs
│   └── cli/         — `nerve` command
├── packages/
│   ├── ir/          — Zod IR (single source of truth)
│   ├── store/       — better-sqlite3 DAOs + migrations
│   ├── planner/     — compile-task: heuristic classifier, model table, teaching selector
│   ├── miner/       — failure clustering by deterministic signature
│   ├── learner/     — teachings + patch candidates per cluster
│   ├── replay/      — simulated runner with honest pass/fail grading
│   ├── verifiers/   — schema/regex/exec/llm_judge + grader API
│   ├── importers/   — native JSONL + OpenAI-style chat log → Trace
│   └── sdk-ts/      — typed client
├── examples/
│   ├── openai-traces/  — 50 seeded JSONL traces across 3 failure clusters
│   └── sdk-demo/       — agent.ts (30 lines) + task.json
├── research/        — design docs (thesis-grounding)
├── scripts/         — demo.sh, gen-fixtures.ts
└── THESIS.md        — product thesis, ICP, defensibility, YC framing
```

---

## Limitations (v0.1)

This is the smallest thing that proves the loop. It deliberately does not yet do:

- **No real LLM calls inside the planner.** Heuristic classifier; the LLM seam is documented and ready in `packages/planner/src/`. Drop in a model call when you want LLM-quality classification — the IR contract is unchanged.
- **No vector retrieval.** `ContextPack` honors `context_refs` the agent passes in; full RAG (sqlite-vss / FAISS) is v0.2.
- **No gateway proxy.** nerve tells the agent *what* to call; it does not intercept provider traffic. Use OpenRouter / LiteLLM / Vercel AI Gateway downstream.
- **No multi-tenant SaaS / billing / RBAC.** One SQLite file, one process, one team. Self-host only.
- **No dashboard / UI.** Read API + JSON only. Pipe to Langfuse/Grafana if you want graphs.
- **No auto-promotion of patches.** Every patch requires `patches approve`.
- **Replay uses a simulated model**, deterministically tied to cluster signatures, so the demo runs without API keys. The grader interface (`packages/verifiers/`) is the same one a real-model replay would use; swap `replay/src/index.ts:simulate()` for a real call when you bring keys.
- **TokenOps gateway SSE is simulated from complete responses.** Real provider token-level delta proxying is still future work.
- **No fine-tuning.** nerve learns by changing *policy and context*, not weights.

What is **honest**:
- 19/19 tests pass (`pnpm test`).
- The demo runs from a clean install in ~8s, deterministically.
- The replay numbers reflect real Zod-validated grader output, not hardcoded values.
- Every API call writes a Receipt with `inputs_hash`, `outputs_hash`, cost, latency.

---

## Relationship to existing tools

| Tool | Relationship |
|---|---|
| **OpenRouter / LiteLLM / Vercel AI Gateway** | Downstream of nerve. nerve emits `model.primary`; you route to it. We will publish a `nerve-routed` adapter for LiteLLM. |
| **Langfuse / LangSmith** | Upstream of nerve. We import their trace formats and re-emit the same span schema. Bring your existing logs. |
| **Braintrust** | Complementary. nerve generates `EvalCase`s; pipe to Braintrust as a JSON dataset if you want their experiment UI. |
| **DSPy** | Spiritual ancestor. DSPy compiles offline in Python; nerve compiles online over HTTP, agent-facing, language-agnostic. We will wrap DSPy's `MIPROv2` inside `/learn` in v0.2. |
| **OpenAI Agents SDK / LangGraph / Mastra** | Frameworks call us. Add a `compileTask()` step before each model call. |
| **E2B / Daytona / Modal** | Substrate, not competition. We will run verifier execs in E2B for v0.2. |

---

## Reuse from Efe's other repos (local archaeology)

The product was designed with re-use in mind:

| Repo | What it gives nerve |
|---|---|
| **capsule** (TS) | `CapsuleReceipt` → our Receipt shape; `CapabilityMap`/`SupportLevel` → model capability declaration; `store-sqlite` pattern. |
| **fides** (TS) | `EvidenceChain` (hash-chained + Merkle + Ed25519) → signed receipts (v0.2); `PolicyBundle.evaluatePolicy()` → patch gating; `DelegationToken` → task-budget mandate. |
| **switchboard** (Rust) | `sb-events` + `sb-replay` + `sb-memory` shapes ported to TS for the trace store + deterministic replay + scoped lesson store. |
| **OAPS** | JSON schemas (`intent.json`, `task.json`, `evidence-event.json`) align with TaskEnvelope / Trace wire format. |
| **OSP** | `cost-summary` + `usage-report` + `service-manifest` → budget + provider declaration shapes. |
| **agentbox / agit / sardis** | Concepts only (three-bucket policy classifier, content-addressed state DAG, mandate→policy→execution→signed receipt). |

See `THESIS.md` and `research/local-repo-map.md` for the full archaeology.

---

## Status

**v0.1 (alpha, 2026-05).** Working loop, working tests, working demo. Not yet production-ready.
Roadmap: real-LLM planner classifier · vector retrieval · DSPy wrap in `/learn` · LiteLLM/OpenRouter adapter · Python SDK · auto-promotion gate with stricter eval thresholds · OTel/Langfuse trace export.

License: MIT.
