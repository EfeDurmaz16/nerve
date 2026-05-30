# nerve API Spec — v0.1

Six verbs. Agent-facing JSON over HTTP. No dashboard. All requests carry `Idempotency-Key` header (optional but recommended); responses carry `X-Receipt-Id`. All bodies are typed against the IR schemas in `ir-schemas.md`. Auth in v0.1 is a single bearer token from env (`NERVE_TOKEN`); multi-tenant is out of scope.

Base URL: `POST http://localhost:7777/v1/...`

---

## 1. `POST /v1/compile-task` — task → ComputePlan

**Purpose:** Turn an agent's intent into a budget-aware compute plan with curated context and teachings.

**Request:**
```json
{ "task": TaskEnvelope }
```
The `task_id` may be supplied by the caller (for idempotency) or omitted (server assigns ULID).

**Response:**
```json
{
  "plan": ComputePlan,
  "context_pack": ContextPack,
  "teaching_program": TeachingProgram | null,
  "receipt_id": "rcpt_..."
}
```

**What the planner DOES:**
1. **Task Classifier** (LLM, small/fast model) — labels modality + risk class if `unknown`.
2. **Context Compiler** — retrieves from indexed sources, scores, compresses; emits ContextPack.
3. **Teaching Selector** — pulls TeachingObjects whose `scope` matches the task and ranks by `wins/uses`; assembles TeachingProgram.
4. **Model Selector + Budget Planner** — deterministic table given (risk × modality × budget_hint) yields primary/fallback models, temperature, caps.
5. **Verifier Planner** — pick verifiers based on risk class and any `verifier_hint` teachings.
6. **Fallback Planner** — assemble fallback_policy from risk + budget.

**Idempotency:** Same `task_id` + same task body hash returns the same plan (cached row). Different body hash for an existing `task_id` → 409.

**Failure modes:** retrieval timeout (returns plan with empty ContextPack + warning); LLM classifier failure (degrades to heuristic defaults); budget under hard floor (422 `budget_infeasible`).

---

## 2. `POST /v1/record-trace` — execution evidence → Trace

**Purpose:** Persist what actually happened when the plan ran. The agent (or its SDK wrapper) ships traces here.

**Request:**
```json
{ "trace": Trace }
```
Accepts native nerve Traces. A sibling endpoint `POST /v1/record-trace/import?format=openai_jsonl|langsmith|otel` accepts foreign formats and converts.

**Response:**
```json
{
  "trace_id": "...",
  "accepted_events": 42,
  "outcome": "success" | "failure" | "partial" | "aborted",
  "receipt_id": "rcpt_..."
}
```

**What it DOES:**
1. Validates Trace, splits the `events` array into `trace_events` rows.
2. Computes derived fields: `cost_usd` (sum), `latency_ms` (last - first ts), `outcome` (if not provided — derived from verifier_runs and errors).
3. Enqueues the trace for the miner (`failures` queue if `outcome != success`, `corpus` queue always).
4. Updates `uses` counter on TeachingObjects referenced by any `correction` event.

**Idempotency:** Trace `trace_id` is unique; resubmit with same id and same `events` hash is a no-op returning the original receipt. Different events with same id → 409.

**Failure modes:** schema mismatch (422 with field path); unknown `task_id` (auto-creates a stub task with `intent: "<imported>"` so traces from foreign systems still land).

---

## 3. `POST /v1/generate-evals` — failures → EvalCases

**Purpose:** Synthesize regression tests from failure clusters so improvements are measurable.

**Request:**
```json
{
  "cluster_ids": ["..."] | null,    // null = all clusters since last call
  "max_per_cluster": 5,
  "grader_default": "llm_judge" | "exec" | "exact"
}
```

**Response:**
```json
{ "evals": [EvalCase], "receipt_id": "rcpt_..." }
```

**What it DOES:**
1. For each cluster, loads exemplar trace + a sample of cluster members.
2. **Eval Generator** (LLM-backed) — extracts the input pattern, the expected output (from the corrected-after trace if present, or synthesized), picks an appropriate grader.
3. Deduplicates against existing evals by input hash.
4. Stores in `evals` table tagged with `source_cluster_id`.

**Idempotency:** Same `(cluster_id, input_hash)` → no duplicate insert. Safe to call repeatedly.

**Failure modes:** cluster too small (skipped, returned in `warnings`); LLM refusal to synthesize expected output → falls back to extracting from the post-correction trace; if neither, eval is created with grader `llm_judge` only.

---

## 4. `POST /v1/learn` — clusters → TeachingObjects + PatchCandidates

**Purpose:** Convert mined failures into reusable lessons and proposed policy patches.

**Request:**
```json
{
  "cluster_ids": ["..."] | null,
  "modes": ["teach","patch"],       // either or both
  "review_required": true            // v0.1 default true
}
```

**Response:**
```json
{
  "teachings": [TeachingObject],
  "patches": [PatchCandidate],       // status: "proposed"
  "receipt_id": "rcpt_..."
}
```

**What it DOES:**
1. **Failure Miner** must have already produced clusters (runs async after `record-trace`); `learn` reads them.
2. **Teaching Compiler** (LLM) inspects exemplars and emits 1-N TeachingObjects per cluster, choosing `type` based on failure_mode (e.g. `tool_misuse` → `policy` + `correction`; `wrong_output` → `correction` + `test`).
3. Generates PatchCandidates: typically one `prompt_patch` and/or `routing_rule` per cluster, with `expected_delta` from a dry-run against existing evals.
4. With `review_required: true`, patches are stored as `proposed` and surfaced via `GET /v1/patches?status=proposed` — they do NOT go live until `POST /v1/patches/:id/approve` (a 7th endpoint, internal, not user-facing).

**Idempotency:** Re-running on the same cluster returns previously created teachings (matched by `(cluster_id, type, content_hash)`). Patches are versioned per call.

**Failure modes:** no clusters found (200 with empty arrays + note); LLM teaching synthesis returns malformed → row stored with `confidence: 0` and `status: "needs_review"`.

---

## 5. `POST /v1/verify` — output → pass/fail with structured detail

**Purpose:** Run the verifier suite defined in a ComputePlan against an arbitrary output, ad-hoc, without recording a full trace. Useful inside agent inner loops.

**Request:**
```json
{
  "plan_id": "..." | null,
  "verifiers": [VerifierSpec] | null,  // one of plan_id or verifiers is required
  "input": <task input>,
  "output": <model output>
}
```

**Response:**
```json
{
  "passed": true | false,
  "results": [
    { "kind": "schema", "passed": false, "detail": "missing field .x" },
    { "kind": "llm_judge", "passed": true, "detail": "..." }
  ],
  "receipt_id": "rcpt_..."
}
```

**What it DOES:**
Runs each verifier in order; short-circuits on the first `required: true` failure unless `mode=all` query param is set. Records a lightweight `verifier_run` event linked to `plan_id` if provided (for telemetry).

**Idempotency:** Pure function of inputs (modulo `llm_judge` nondeterminism). Same `(input_hash, output_hash, verifiers_hash)` returns cached result within a 1-hour window.

**Failure modes:** verifier crash → that verifier reports `passed: false, detail: "verifier_error: ..."`; never crashes the whole call.

---

## 6. `POST /v1/replay` — patches × evals → delta report

**Purpose:** Run candidate patches against the eval suite (or a slice of historical traces) and produce a before/after delta. This is the gate before promoting a patch.

**Request:**
```json
{
  "patch_ids": ["..."],            // candidates to evaluate
  "baseline": "current_policy",    // or a prior patch_id
  "eval_ids": ["..."] | null,      // null = all evals
  "sample": 100                    // cap for cost control
}
```

**Response:**
```json
{
  "replay_id": "...",
  "baseline": { "pass_rate": 0.62, "cost_usd": 1.20, "latency_ms_p50": 800 },
  "candidates": [
    { "patch_id": "...", "pass_rate": 0.81, "cost_usd": 1.05, "latency_ms_p50": 900, "delta": {...}, "regressions": [eval_id, ...] }
  ],
  "receipt_id": "rcpt_..."
}
```

**What it DOES:**
1. **Replay Runner** materializes the effective policy under baseline and under each patch.
2. Runs each EvalCase through `compile-task` (with patches applied) → executes against the configured model → runs grader.
3. Aggregates metrics; flags any eval that regresses (pass→fail under the candidate).
4. Writes `replay_summary_id` back onto each PatchCandidate for the review gate.

**Idempotency:** Deterministic given `(patch_ids, baseline, eval_ids, sample seed)`. Cached by hash.

**Failure modes:** model rate limit (partial replay returned with `coverage: 0.7`); eval grader timeout (marked `inconclusive`, not counted as fail); patch produces invalid plan (patch flagged `invalid`, excluded from candidates).

---

## Cross-cutting

- All responses carry `X-Receipt-Id`; the corresponding Receipt row is queryable via `GET /v1/receipts/:id` (read-only).
- All errors use RFC 7807 problem+json with `type` URIs under `nerve://errors/`.
- Streaming variants (`compile-task` SSE for context retrieval progress) are deferred to v0.2.
