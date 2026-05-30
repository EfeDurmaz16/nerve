# nerve IR Schemas

The IR is the contract between agent, planner, miner, and learner. Every object carries `schema_version` (semver string) so we can evolve without breaking stored data. All IDs are ULIDs (lexicographically sortable, debuggable). All timestamps are ISO-8601 UTC strings.

Storage strategy is opinionated for SQLite (better-sqlite3) in v0.1; objects that grow unboundedly or have per-row query needs get their own table, everything else lives as a JSON blob on the parent row.

---

## TaskEnvelope

The agent's request. Tiny, opaque to nerve's internals — the planner derives everything else from it.

```ts
const TaskEnvelope = z.object({
  schema_version: z.literal("0.1"),
  task_id: z.string(),                     // ULID, agent-provided or server-assigned
  agent_id: z.string(),                    // who is asking
  intent: z.string(),                      // natural-language description of goal
  inputs: z.record(z.unknown()),           // structured inputs (code, query, etc.)
  modality: z.enum(["text","code","tool_use","multi_turn"]),
  risk_class: z.enum(["low","medium","high","unknown"]).default("unknown"),
  budget_hint: z.object({
    max_usd: z.number().optional(),
    max_latency_ms: z.number().optional(),
    max_tokens: z.number().optional(),
  }).partial(),
  tools_available: z.array(z.string()).default([]),
  context_refs: z.array(z.string()).default([]), // pointers to docs/files
  parent_task_id: z.string().nullable(),
  created_at: z.string(),
});
```

**Storage:** single row in `tasks` table. `inputs`, `budget_hint`, `tools_available`, `context_refs` as JSON columns. Indexed on `agent_id`, `created_at`.

**Relations:** FK from ComputePlan, Trace, Receipt.

---

## ComputePlan

The compiled output. This is what nerve gives back to the agent.

```ts
const ComputePlan = z.object({
  schema_version: z.literal("0.1"),
  plan_id: z.string(),
  task_id: z.string(),                     // FK
  model: z.object({
    primary: z.string(),                   // "claude-opus-4-7"
    fallback: z.array(z.string()),         // ordered
    temperature: z.number(),
    max_output_tokens: z.number(),
  }),
  context_pack_id: z.string(),             // FK
  teaching_program_id: z.string().nullable(), // FK, nullable if no lessons apply
  verifiers: z.array(z.object({
    kind: z.enum(["schema","regex","llm_judge","exec","custom"]),
    config: z.record(z.unknown()),
    required: z.boolean(),
  })),
  budget: z.object({
    target_usd: z.number(),
    hard_cap_usd: z.number(),
    target_latency_ms: z.number(),
  }),
  fallback_policy: z.enum(["retry_same","escalate_model","degrade_model","ask_human","abort"]),
  cache_policy: z.object({
    use_cache: z.boolean(),
    ttl_s: z.number(),
  }),
  rationale: z.string(),                   // why these choices (debuggable)
  created_at: z.string(),
});
```

**Storage:** single row in `compute_plans`. Nested objects as JSON. We do not normalize `verifiers` — they are read together with the plan. Indexed on `task_id` (unique latest plan per task).

**Relations:** 1:1 with TaskEnvelope (latest); references ContextPack and TeachingProgram by ID.

---

## ContextPack

Only the relevant context, compressed. Separates *what* was injected from *why*.

```ts
const ContextPack = z.object({
  schema_version: z.literal("0.1"),
  pack_id: z.string(),
  task_id: z.string(),
  chunks: z.array(z.object({
    chunk_id: z.string(),
    source: z.string(),                    // URI or doc_id
    text: z.string(),
    tokens: z.number(),
    score: z.number(),                     // retrieval relevance
    reason: z.enum(["semantic","keyword","graph","recent","pinned"]),
  })),
  total_tokens: z.number(),
  compression_ratio: z.number(),           // tokens_in_pack / tokens_in_source_pool
  policy_id: z.string(),                   // which retrieval policy was used
  created_at: z.string(),
});
```

**Storage:** row in `context_packs` for metadata; `chunks` as JSON blob. Chunks rarely re-queried individually; if they are (replay diffing), we re-derive from `source` URIs. For large packs (>100 KB), we spill the blob to `blobs/` on disk and store a hash.

---

## TeachingObject (discriminated union)

The atomic unit of learned knowledge. Type-discriminated so the learner can route by kind.

```ts
const TeachingBase = z.object({
  schema_version: z.literal("0.1"),
  teaching_id: z.string(),
  origin_failure_cluster_id: z.string().nullable(),
  scope: z.object({                        // when this applies
    task_modality: z.array(z.string()).optional(),
    risk_class: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
  }),
  confidence: z.number(),                  // 0..1, decays with disuse
  uses: z.number().default(0),
  wins: z.number().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

const TeachingObject = z.discriminatedUnion("type", [
  TeachingBase.extend({ type: z.literal("correction"),       wrong: z.string(), right: z.string() }),
  TeachingBase.extend({ type: z.literal("misconception"),    belief: z.string(), reality: z.string() }),
  TeachingBase.extend({ type: z.literal("counterexample"),   pattern: z.string(), example: z.string() }),
  TeachingBase.extend({ type: z.literal("prerequisite"),     before: z.string(), then: z.string() }),
  TeachingBase.extend({ type: z.literal("test"),             input: z.unknown(), expect: z.unknown() }),
  TeachingBase.extend({ type: z.literal("review_item"),      question: z.string(), answer: z.string(), next_review_at: z.string() }),
  TeachingBase.extend({ type: z.literal("consolidation_item"), summary: z.string(), source_teaching_ids: z.array(z.string()) }),
  TeachingBase.extend({ type: z.literal("policy"),           rule: z.string(), enforce: z.enum(["hint","block"]) }),
  TeachingBase.extend({ type: z.literal("verifier_hint"),    verifier_kind: z.string(), config_patch: z.record(z.unknown()) }),
]);
```

**Storage:** one table `teachings` with a `type` column for cheap filtering. Payload-specific fields as JSON. Indexed on `type`, `origin_failure_cluster_id`, and a GIN-ish FTS on `scope.keywords` (SQLite FTS5).

**Relations:** many-to-many with TeachingProgram via join table.

---

## TeachingProgram

A curated, ordered bundle of teachings shaped for one ComputePlan. Cheap to recompute, expensive to design well.

```ts
const TeachingProgram = z.object({
  schema_version: z.literal("0.1"),
  program_id: z.string(),
  task_id: z.string(),
  teachings: z.array(z.object({
    teaching_id: z.string(),
    render_mode: z.enum(["system_prefix","fewshot","verifier_config","tool_doc"]),
    order: z.number(),
  })),
  total_token_cost: z.number(),
  selection_rationale: z.string(),
  created_at: z.string(),
});
```

**Storage:** row in `teaching_programs`, teachings list as JSON. Join through `teaching_id`s is fine at v0.1 scale.

---

## Trace + Event

Every observable step of execution.

```ts
const Event = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("model_call"),  ts: z.string(), model: z.string(), prompt_hash: z.string(), tokens_in: z.number(), tokens_out: z.number(), latency_ms: z.number(), usd: z.number(), output_excerpt: z.string() }),
  z.object({ kind: z.literal("tool_call"),   ts: z.string(), tool: z.string(), args_hash: z.string(), latency_ms: z.number(), ok: z.boolean(), error: z.string().nullable() }),
  z.object({ kind: z.literal("verifier_run"),ts: z.string(), verifier_kind: z.string(), passed: z.boolean(), detail: z.string() }),
  z.object({ kind: z.literal("correction"),  ts: z.string(), teaching_id: z.string().nullable(), note: z.string() }),
  z.object({ kind: z.literal("error"),       ts: z.string(), code: z.string(), message: z.string() }),
]);

const Trace = z.object({
  schema_version: z.literal("0.1"),
  trace_id: z.string(),
  task_id: z.string(),
  plan_id: z.string().nullable(),          // null for imported foreign traces
  outcome: z.enum(["success","failure","partial","aborted"]),
  events: z.array(Event),                  // truncated for huge traces — full in events table
  cost_usd: z.number(),
  latency_ms: z.number(),
  created_at: z.string(),
});
```

**Storage:** `traces` row + separate `trace_events` table (one row per event, ordered, indexed by `trace_id`, `kind`). Trace summary holds a *capped* preview (first/last 20 events) for fast list views; the full series lives in `trace_events`. This avoids loading 10 MB blobs to render a list page and lets the miner stream events.

---

## FailureCluster

Output of the miner — groups of related failures.

```ts
const FailureCluster = z.object({
  schema_version: z.literal("0.1"),
  cluster_id: z.string(),
  label: z.string(),                       // LLM-generated short name
  signature: z.string(),                   // hash of failure pattern
  trace_ids: z.array(z.string()),
  exemplar_trace_id: z.string(),
  failure_mode: z.enum(["wrong_output","tool_misuse","spec_violation","cost_overrun","loop","refusal","other"]),
  frequency: z.number(),
  cost_usd_total: z.number(),
  first_seen: z.string(),
  last_seen: z.string(),
});
```

**Storage:** `failure_clusters` table. `trace_ids` as JSON for v0.1 (bounded to top-N per cluster); break out if it grows.

---

## EvalCase

A test extracted/synthesized from failures.

```ts
const EvalCase = z.object({
  schema_version: z.literal("0.1"),
  eval_id: z.string(),
  source_cluster_id: z.string().nullable(),
  inputs: z.record(z.unknown()),
  expected: z.union([z.string(), z.record(z.unknown())]),
  grader: z.object({
    kind: z.enum(["exact","regex","schema","llm_judge","exec"]),
    config: z.record(z.unknown()),
  }),
  tags: z.array(z.string()),
  created_at: z.string(),
});
```

**Storage:** `evals` table; `inputs`/`expected`/`grader` as JSON. Indexed on `source_cluster_id`, `tags`.

---

## PatchCandidate

A proposed change to policy. Always reviewed before promotion in v0.1.

```ts
const PatchCandidate = z.discriminatedUnion("type", [
  Base.extend({ type: z.literal("prompt_patch"),     target_role: z.enum(["system","developer"]), diff: z.string() }),
  Base.extend({ type: z.literal("routing_rule"),     when: z.record(z.unknown()), choose_model: z.string() }),
  Base.extend({ type: z.literal("verifier_rule"),    verifier_kind: z.string(), config: z.record(z.unknown()) }),
  Base.extend({ type: z.literal("teaching_program"), program_id: z.string() }),
  Base.extend({ type: z.literal("context_policy"),   policy: z.record(z.unknown()) }),
  Base.extend({ type: z.literal("fallback_policy"),  policy: z.string() }),
]);
// Base = { schema_version, patch_id, origin_cluster_id, expected_delta: {pass_rate, cost_usd, latency_ms}, replay_summary_id, status: "proposed"|"approved"|"rejected"|"live", created_at }
```

**Storage:** `patches` table with `type` column. Payload as JSON. Indexed on `status`, `origin_cluster_id`.

---

## Receipt

Cross-cutting audit log. Every API call produces one.

```ts
const Receipt = z.object({
  schema_version: z.literal("0.1"),
  receipt_id: z.string(),
  verb: z.enum(["compile-task","record-trace","generate-evals","learn","verify","replay"]),
  task_id: z.string().nullable(),
  inputs_hash: z.string(),
  outputs_hash: z.string(),
  cost_usd: z.number(),
  latency_ms: z.number(),
  ts: z.string(),
});
```

**Storage:** `receipts` append-only table. Partition by month if it grows. Never updated.

---

## Relation map

```
TaskEnvelope ──1:1──► ComputePlan ──►─ ContextPack
                              └──►─ TeachingProgram ──*──► TeachingObject
TaskEnvelope ──1:N──► Trace ──*──► Event
Trace ──*──► FailureCluster ──1:N──► EvalCase
FailureCluster ──1:N──► TeachingObject (origin)
FailureCluster ──1:N──► PatchCandidate (origin)
Receipt ── attached to every verb call
```
