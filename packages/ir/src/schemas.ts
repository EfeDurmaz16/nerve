import { z } from "zod";

export const SchemaVersion = z.literal("0.1");
export const Iso = z.string().describe("ISO-8601 UTC timestamp");

// ─── TaskEnvelope ─────────────────────────────────────────────────────────────
export const Modality = z.enum(["text", "code", "tool_use", "multi_turn"]);
export const RiskClass = z.enum(["low", "medium", "high", "unknown"]);

export const BudgetHint = z
  .object({
    max_usd: z.number().nonnegative().optional(),
    max_latency_ms: z.number().int().nonnegative().optional(),
    max_tokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const TaskEnvelope = z
  .object({
    schema_version: SchemaVersion,
    task_id: z.string(),
    agent_id: z.string(),
    intent: z.string(),
    inputs: z.record(z.unknown()).default({}),
    modality: Modality,
    risk_class: RiskClass.default("unknown"),
    budget_hint: BudgetHint.default({}),
    tools_available: z.array(z.string()).default([]),
    context_refs: z.array(z.string()).default([]),
    parent_task_id: z.string().nullable().default(null),
    created_at: Iso,
  })
  .strict();
export type TaskEnvelope = z.infer<typeof TaskEnvelope>;

// ─── ContextPack ──────────────────────────────────────────────────────────────
export const ContextChunk = z
  .object({
    chunk_id: z.string(),
    source: z.string(),
    text: z.string(),
    tokens: z.number().int().nonnegative(),
    score: z.number(),
    reason: z.enum(["semantic", "keyword", "graph", "recent", "pinned"]),
  })
  .strict();

export const ContextPack = z
  .object({
    schema_version: SchemaVersion,
    pack_id: z.string(),
    task_id: z.string(),
    chunks: z.array(ContextChunk),
    total_tokens: z.number().int().nonnegative(),
    compression_ratio: z.number(),
    policy_id: z.string(),
    created_at: Iso,
  })
  .strict();
export type ContextPack = z.infer<typeof ContextPack>;

// ─── TeachingObject (discriminated union) ─────────────────────────────────────
export const TeachingScope = z
  .object({
    task_modality: z.array(Modality).optional(),
    risk_class: z.array(RiskClass).optional(),
    tools: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
  })
  .strict();

const TeachingBase = z.object({
  schema_version: SchemaVersion,
  teaching_id: z.string(),
  origin_failure_cluster_id: z.string().nullable(),
  scope: TeachingScope,
  confidence: z.number().min(0).max(1),
  uses: z.number().int().nonnegative().default(0),
  wins: z.number().int().nonnegative().default(0),
  created_at: Iso,
  updated_at: Iso,
});

export const TeachingObject = z.discriminatedUnion("type", [
  TeachingBase.extend({ type: z.literal("correction"), wrong: z.string(), right: z.string() }),
  TeachingBase.extend({ type: z.literal("misconception"), belief: z.string(), reality: z.string() }),
  TeachingBase.extend({ type: z.literal("counterexample"), pattern: z.string(), example: z.string() }),
  TeachingBase.extend({ type: z.literal("prerequisite"), before: z.string(), then: z.string() }),
  TeachingBase.extend({ type: z.literal("test"), input: z.unknown(), expect: z.unknown() }),
  TeachingBase.extend({
    type: z.literal("review_item"),
    question: z.string(),
    answer: z.string(),
    next_review_at: Iso,
  }),
  TeachingBase.extend({
    type: z.literal("consolidation_item"),
    summary: z.string(),
    source_teaching_ids: z.array(z.string()),
  }),
  TeachingBase.extend({ type: z.literal("policy"), rule: z.string(), enforce: z.enum(["hint", "block"]) }),
  TeachingBase.extend({
    type: z.literal("verifier_hint"),
    verifier_kind: z.string(),
    config_patch: z.record(z.unknown()),
  }),
]);
export type TeachingObject = z.infer<typeof TeachingObject>;
export type TeachingType = TeachingObject["type"];

// ─── TeachingProgram ──────────────────────────────────────────────────────────
export const RenderMode = z.enum(["system_prefix", "fewshot", "verifier_config", "tool_doc"]);

export const TeachingProgram = z
  .object({
    schema_version: SchemaVersion,
    program_id: z.string(),
    task_id: z.string(),
    teachings: z.array(
      z
        .object({ teaching_id: z.string(), render_mode: RenderMode, order: z.number().int() })
        .strict(),
    ),
    total_token_cost: z.number().int().nonnegative(),
    selection_rationale: z.string(),
    created_at: Iso,
  })
  .strict();
export type TeachingProgram = z.infer<typeof TeachingProgram>;

// ─── Verifier spec ────────────────────────────────────────────────────────────
export const VerifierKind = z.enum(["schema", "regex", "llm_judge", "exec", "custom"]);
export const VerifierSpec = z
  .object({
    kind: VerifierKind,
    config: z.record(z.unknown()).default({}),
    required: z.boolean().default(true),
  })
  .strict();
export type VerifierSpec = z.infer<typeof VerifierSpec>;

// ─── ComputePlan ──────────────────────────────────────────────────────────────
export const FallbackPolicy = z.enum([
  "retry_same",
  "escalate_model",
  "degrade_model",
  "ask_human",
  "abort",
]);

export const ComputePlan = z
  .object({
    schema_version: SchemaVersion,
    plan_id: z.string(),
    task_id: z.string(),
    model: z
      .object({
        primary: z.string(),
        fallback: z.array(z.string()).default([]),
        temperature: z.number().min(0).max(2),
        max_output_tokens: z.number().int().positive(),
      })
      .strict(),
    context_pack_id: z.string(),
    teaching_program_id: z.string().nullable(),
    verifiers: z.array(VerifierSpec),
    budget: z
      .object({
        target_usd: z.number().nonnegative(),
        hard_cap_usd: z.number().nonnegative(),
        target_latency_ms: z.number().int().nonnegative(),
      })
      .strict(),
    fallback_policy: FallbackPolicy,
    cache_policy: z
      .object({ use_cache: z.boolean(), ttl_s: z.number().int().nonnegative() })
      .strict(),
    rationale: z.string(),
    created_at: Iso,
  })
  .strict();
export type ComputePlan = z.infer<typeof ComputePlan>;

// ─── Trace + Event ────────────────────────────────────────────────────────────
export const Event = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("model_call"),
      ts: Iso,
      model: z.string(),
      prompt_hash: z.string(),
      tokens_in: z.number().int().nonnegative(),
      tokens_out: z.number().int().nonnegative(),
      latency_ms: z.number().int().nonnegative(),
      usd: z.number().nonnegative(),
      output_excerpt: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool_call"),
      ts: Iso,
      tool: z.string(),
      args_hash: z.string(),
      latency_ms: z.number().int().nonnegative(),
      ok: z.boolean(),
      error: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("verifier_run"),
      ts: Iso,
      verifier_kind: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("correction"),
      ts: Iso,
      teaching_id: z.string().nullable(),
      note: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("error"), ts: Iso, code: z.string(), message: z.string() }).strict(),
]);
export type Event = z.infer<typeof Event>;

export const Outcome = z.enum(["success", "failure", "partial", "aborted"]);
export type Outcome = z.infer<typeof Outcome>;

export const Trace = z
  .object({
    schema_version: SchemaVersion,
    trace_id: z.string(),
    task_id: z.string(),
    plan_id: z.string().nullable(),
    outcome: Outcome,
    events: z.array(Event),
    cost_usd: z.number().nonnegative(),
    latency_ms: z.number().int().nonnegative(),
    created_at: Iso,
  })
  .strict();
export type Trace = z.infer<typeof Trace>;

// ─── FailureCluster ───────────────────────────────────────────────────────────
export const FailureMode = z.enum([
  "wrong_output",
  "tool_misuse",
  "spec_violation",
  "cost_overrun",
  "loop",
  "refusal",
  "other",
]);

export const FailureCluster = z
  .object({
    schema_version: SchemaVersion,
    cluster_id: z.string(),
    label: z.string(),
    signature: z.string(),
    trace_ids: z.array(z.string()),
    exemplar_trace_id: z.string(),
    failure_mode: FailureMode,
    frequency: z.number().int().positive(),
    cost_usd_total: z.number().nonnegative(),
    first_seen: Iso,
    last_seen: Iso,
  })
  .strict();
export type FailureCluster = z.infer<typeof FailureCluster>;

// ─── EvalCase ─────────────────────────────────────────────────────────────────
export const GraderKind = z.enum(["exact", "regex", "schema", "llm_judge", "exec"]);
export const EvalCase = z
  .object({
    schema_version: SchemaVersion,
    eval_id: z.string(),
    source_cluster_id: z.string().nullable(),
    inputs: z.record(z.unknown()),
    expected: z.union([z.string(), z.record(z.unknown())]),
    grader: z.object({ kind: GraderKind, config: z.record(z.unknown()).default({}) }).strict(),
    tags: z.array(z.string()).default([]),
    created_at: Iso,
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

// ─── PatchCandidate ───────────────────────────────────────────────────────────
export const PatchStatus = z.enum(["proposed", "approved", "rejected", "live"]);
const PatchBase = z.object({
  schema_version: SchemaVersion,
  patch_id: z.string(),
  origin_cluster_id: z.string().nullable(),
  expected_delta: z
    .object({
      pass_rate: z.number(),
      cost_usd: z.number(),
      latency_ms: z.number(),
    })
    .strict(),
  replay_summary_id: z.string().nullable(),
  status: PatchStatus,
  created_at: Iso,
});

export const PatchCandidate = z.discriminatedUnion("type", [
  PatchBase.extend({
    type: z.literal("prompt_patch"),
    target_role: z.enum(["system", "developer"]),
    diff: z.string(),
  }),
  PatchBase.extend({
    type: z.literal("routing_rule"),
    when: z.record(z.unknown()),
    choose_model: z.string(),
  }),
  PatchBase.extend({
    type: z.literal("verifier_rule"),
    verifier_kind: z.string(),
    config: z.record(z.unknown()),
  }),
  PatchBase.extend({ type: z.literal("teaching_program"), program_id: z.string() }),
  PatchBase.extend({ type: z.literal("context_policy"), policy: z.record(z.unknown()) }),
  PatchBase.extend({ type: z.literal("fallback_policy"), policy: FallbackPolicy }),
]);
export type PatchCandidate = z.infer<typeof PatchCandidate>;
export type PatchType = PatchCandidate["type"];

// ─── Receipt ──────────────────────────────────────────────────────────────────
export const Verb = z.enum([
  "compile-task",
  "record-trace",
  "generate-evals",
  "learn",
  "verify",
  "replay",
]);

export const Receipt = z
  .object({
    schema_version: SchemaVersion,
    receipt_id: z.string(),
    verb: Verb,
    task_id: z.string().nullable(),
    inputs_hash: z.string(),
    outputs_hash: z.string(),
    cost_usd: z.number().nonnegative(),
    latency_ms: z.number().int().nonnegative(),
    ts: Iso,
  })
  .strict();
export type Receipt = z.infer<typeof Receipt>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const parseOrThrow = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`IR validation: ${r.error.message}`);
  return r.data;
};
