# nerve Architecture — v0.1

Single-process, single-SQLite-file Node service. Two flow directions: **forward** (task → plan) and **backward** (trace → learning). The Receipt layer cuts across both.

---

## Topology

```
                                    ┌──────────────────────────────────────┐
                                    │              Agent / SDK             │
                                    └──────────────┬───────────────────────┘
                                                   │  HTTP (6 verbs)
                                    ┌──────────────▼───────────────────────┐
                                    │           Agent API (Fastify)        │
                                    │  compile-task  record-trace  verify  │
                                    │  generate-evals  learn  replay       │
                                    └──┬─────────┬──────────┬─────────┬────┘
                                       │         │          │         │
       ┌───────────────────────────────▼─┐       │          │         │
       │            PLANNER              │       │          │         │
       │  ┌──────────────────────────┐   │       │          │         │
       │  │ Task Classifier   (LLM)  │   │       │          │         │
       │  │ Risk Classifier   (LLM*) │   │       │          │         │
       │  │ Context Compiler  (RAG)  │◄──┼───┐   │          │         │
       │  │ Teaching Selector (det.) │◄──┼─┐ │   │          │         │
       │  │ Model Selector    (det.) │   │ │ │   │          │         │
       │  │ Budget Planner    (det.) │   │ │ │   │          │         │
       │  │ Verifier Planner  (det.) │   │ │ │   │          │         │
       │  │ Fallback Planner  (det.) │   │ │ │   │          │         │
       │  └──────────────┬───────────┘   │ │ │   │          │         │
       │                 │ ComputePlan   │ │ │   │          │         │
       └─────────────────┼───────────────┘ │ │   │          │         │
                         │                 │ │   │          │         │
                         ▼                 │ │   │          │         │
                ┌────────────────┐         │ │   │          │         │
                │  Agent runs    │         │ │   │          │         │
                │  it externally │         │ │   │          │         │
                └────────┬───────┘         │ │   │          │         │
                         │ Trace           │ │   │          │         │
                         ▼                 │ │   │          │         │
                ┌──────────────────────────▼─▼───▼────┐    │         │
                │           Trace Store               │    │         │
                │   (tasks / traces / trace_events)   │    │         │
                └─────────────┬───────────────────────┘    │         │
                              │                            │         │
       ┌──────────────────────▼──────────────────────┐     │         │
       │              FAILURE MINER                  │     │         │
       │  embed → cluster → label(LLM) → signature   │     │         │
       └──────────────────────┬──────────────────────┘     │         │
                              │ FailureClusters            │         │
              ┌───────────────┼────────────────┐           │         │
              ▼               ▼                ▼           │         │
   ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐ │         │
   │ TEACHING COMPILER│ │ EVAL GENERATOR│ │   LEARNER    │ │         │
   │   (LLM)          │ │   (LLM)       │ │ (patch synth)│ │         │
   │ → TeachingObject │ │ → EvalCase    │ │ → PatchCand. │ │         │
   └─────────┬────────┘ └──────┬───────┘ └──────┬───────┘ │         │
             │                 │                │         │         │
             │                 ▼                │         │         │
             │         ┌──────────────┐         │         │         │
             │         │ Eval Store   │◄────────┘         │         │
             │         └──────┬───────┘                   │         │
             │                │                           │         │
             │                ▼                           │         │
             │      ┌────────────────────┐                │         │
             │      │   REPLAY RUNNER    │◄───────────────┴─────────┘
             │      │ baseline vs. patch │
             │      └─────────┬──────────┘
             │                │ delta
             │                ▼
             │      ┌────────────────────┐
             │      │   REVIEW GATE      │
             │      │ (manual approve)   │
             │      └─────────┬──────────┘
             │                │
             ▼                ▼
        ┌──────────────────────────┐
        │   POLICY STORE           │  ◄── consumed by Planner on next compile-task
        │ teachings / patches:live │
        └──────────────────────────┘

         ═══════════════════════════════════════════════════════
                 RECEIPT LAYER (every verb writes one)
         ═══════════════════════════════════════════════════════
```

---

## Components

### Agent API (Fastify, `apps/server`)
Thin HTTP layer. Parses bodies against IR schemas, routes to a service module, writes a Receipt on every request (in the same SQLite transaction as the primary write so a successful response implies a durable receipt). No business logic here.

### Planner (`packages/planner`)
Stateless given (TaskEnvelope, current policy snapshot, indexed corpus). Internally a pipeline of sub-planners; each sub-planner has a `kind: "heuristic" | "llm"` flag selected by config.

- **Task Classifier** — LLM-backed. Small/fast model (Haiku-class). Classifies modality and refines `risk_class` when `unknown`. Falls back to heuristic (keyword table) on failure.
- **Risk Classifier** — folded into Task Classifier in v0.1; broken out later when risk needs its own model.
- **Context Compiler** — RAG. v0.1 uses BM25 (sqlite FTS5) + cosine over `sqlite-vss` for embeddings. Returns ContextPack with `chunks[].reason` set per retrieval method. Pluggable retriever interface for future Vespa/Turbopuffer.
- **Teaching Selector** — deterministic in v0.1. Filters TeachingObjects whose `scope` matches the task signal vector, ranks by `wins/uses * confidence`, packs to a token budget. LLM rerank is a v0.2 toggle.
- **Model Selector** — deterministic lookup: `(modality, risk_class, budget_hint.max_usd)` → row from a config table. Editable via patches of type `routing_rule`.
- **Budget Planner** — pure arithmetic: distributes `budget_hint.max_usd` across primary model call, retries, verifiers; emits `target_usd` and `hard_cap_usd`.
- **Verifier Planner** — deterministic mapping from `risk_class` to required verifier kinds, augmented by any `verifier_hint` teachings in scope.
- **Fallback Planner** — deterministic state machine producing `fallback_policy` enum from risk + budget headroom.

The Planner is the ONLY component that calls LLMs during forward flow. Everything else is data shaping.

### Trace Store (`packages/store`)
The `traces` row + `trace_events` table. Append-mostly. Indexed for: list-by-task, list-by-outcome, list-by-time-window, stream-by-trace-id. Same SQLite file holds tasks, plans, packs, programs, teachings, clusters, evals, patches, receipts. WAL mode, `synchronous=NORMAL`, `mmap_size=512MB`.

### Failure Miner (`packages/miner`)
Triggered by `record-trace` for any non-success trace. Steps:
1. **Embed** the failure fingerprint (last assistant turn + verifier failures + error messages) using a small embedding model (`text-embedding-3-small` or local `bge-small`).
2. **Cluster** incrementally — HDBSCAN-lite or online agglomerative against existing cluster centroids; new cluster if min distance > τ.
3. **Label** with a one-shot LLM call: cluster name + `failure_mode` enum.
4. **Signature** = sha256 of (failure_mode, top-k token bigrams from exemplars) for cheap dedup.

In v0.1 runs synchronously inside the request (sub-second for small batches). Spillable to a queue later without API change.

### Teaching Compiler (`packages/learner/teach.ts`)
LLM-backed. Prompt template per `failure_mode` → emits one or more TeachingObjects with appropriate `type`. Each teaching gets `confidence` initialized from cluster `frequency` and exemplar consistency. The compiler is deliberately conservative: prefers narrow, scoped lessons over broad rules.

### Eval Generator (`packages/replay` ... actually `packages/learner/evals.ts`)
LLM-backed. Reads cluster exemplars; for each unique failing input, emits an EvalCase. `expected` comes from the corrected post-fix trace when available; otherwise the LLM proposes one and tags it `confidence: low`, defaulting grader to `llm_judge`. Dedup by input hash.

### Replay Runner (`packages/replay`)
Deterministic orchestrator. For each EvalCase, runs `compile-task` under (a) baseline policy and (b) each candidate patch applied, executes the resulting plan against the configured model, runs the grader. Aggregates pass_rate, cost, latency, and a regression list. Stores a ReplaySummary row referenced by every involved PatchCandidate.

### Review Gate
In v0.1, a CLI command (`nerve patches approve <id>`) flips a PatchCandidate from `proposed` to `live`. No web UI, no auto-promotion. The next `compile-task` reads the live policy snapshot at request time, so promotion is effective immediately.

### Receipt layer (`packages/store/receipts.ts`)
Append-only table written in the same SQLite transaction as the primary effect of each verb. Hash-only of inputs/outputs (sha256) keeps the table small; full bodies live in their typed tables. Receipts are the audit trail that makes nerve trustworthy for high-stakes agents.

---

## What is LLM-backed vs. deterministic in v0.1

| Component             | v0.1 mode                              | Path to v0.2                              |
|-----------------------|----------------------------------------|-------------------------------------------|
| Task Classifier       | LLM (Haiku-class)                      | Distilled local classifier                |
| Risk Classifier       | LLM (shared call)                      | Separate model                            |
| Context Compiler      | Heuristic (BM25 + vss)                 | LLM-rerank + query rewriting              |
| Teaching Selector     | Deterministic (score × scope)          | LLM rerank for top-N                      |
| Model Selector        | Deterministic table                    | Bandit / policy learned from replays      |
| Budget Planner        | Deterministic                          | Stays deterministic                       |
| Verifier Planner      | Deterministic                          | LLM proposes new verifiers from clusters  |
| Fallback Planner      | Deterministic                          | Stays deterministic                       |
| Failure Miner         | Embed + cluster + LLM label            | Online clustering, larger embedder        |
| Teaching Compiler     | LLM                                    | LLM with constitutional checks            |
| Eval Generator        | LLM                                    | Mix of LLM + property-based synthesis     |
| Replay Runner         | Deterministic orchestrator             | Stays deterministic                       |
| Review Gate           | Manual CLI                             | Auto-promote under threshold + canary     |

The pattern: anything that touches *policy correctness* starts manual or deterministic; anything that benefits from language understanding (classify, label, teach, eval-synth) is LLM from day one because there is no good heuristic substitute.

---

## Data flow invariants

- A ComputePlan is immutable once written. A new compile produces a new plan_id even for the same task_id.
- A TeachingObject's content is immutable; only `confidence`, `uses`, `wins`, `updated_at` mutate.
- A PatchCandidate's `status` transitions are append-only via a `patch_events` log (proposed → approved/rejected → live → retired).
- A Receipt is never updated or deleted. Lost receipts mean lost trust; we'd rather double-write than lose one.
- Every LLM call inside nerve produces its own internal Trace (dogfooding) so nerve's own planner can be tuned by nerve.
