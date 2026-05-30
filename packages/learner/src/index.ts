import type { DB } from "@nerve/store";
import {
  listClusters,
  getCluster,
  getTrace,
  insertTeaching,
  insertPatch,
  insertEval,
  listEvals,
} from "@nerve/store";
import { newId, nowIso } from "@nerve/ir";
import type {
  FailureCluster,
  TeachingObject,
  PatchCandidate,
  EvalCase,
  Trace,
  Event,
} from "@nerve/ir";

// ─── learn: cluster → teachings + patch candidates ───────────────────────────
export interface LearnResult {
  teachings: TeachingObject[];
  patches: PatchCandidate[];
}

export function learn(db: DB, opts: { cluster_ids?: string[] | null } = {}): LearnResult {
  const clusters: FailureCluster[] = opts.cluster_ids
    ? (opts.cluster_ids.map((id) => getCluster(db, id)).filter(Boolean) as FailureCluster[])
    : listClusters(db);

  const teachings: TeachingObject[] = [];
  const patches: PatchCandidate[] = [];

  for (const c of clusters) {
    const tch = teachForCluster(c, db);
    teachings.push(...tch);
    for (const t of tch) insertTeaching(db, t);

    const pats = patchForCluster(c);
    patches.push(...pats);
    for (const p of pats) insertPatch(db, p);
  }
  return { teachings, patches };
}

function teachForCluster(c: FailureCluster, db: DB): TeachingObject[] {
  const now = nowIso();
  const exemplar = getTrace(db, c.exemplar_trace_id);
  const errMsg = extractErrorText(exemplar);
  const keywords = c.label.split(/[:_]/).filter((s) => s.length > 2);

  const teachings: TeachingObject[] = [];

  // Always emit a `correction` teaching capturing the wrong → right intent of the cluster.
  teachings.push({
    schema_version: "0.1",
    teaching_id: newId("tch"),
    origin_failure_cluster_id: c.cluster_id,
    type: "correction",
    wrong: errMsg || c.label,
    right: rightForMode(c.failure_mode, errMsg),
    scope: { keywords, task_modality: ["code", "text"] },
    confidence: 0.6,
    uses: 0,
    wins: 0,
    created_at: now,
    updated_at: now,
  });

  // For tool_misuse / spec_violation, also emit a `policy` teaching.
  if (c.failure_mode === "tool_misuse" || c.failure_mode === "spec_violation") {
    teachings.push({
      schema_version: "0.1",
      teaching_id: newId("tch"),
      origin_failure_cluster_id: c.cluster_id,
      type: "policy",
      rule: policyRuleForMode(c.failure_mode, errMsg),
      enforce: "hint",
      scope: { keywords },
      confidence: 0.55,
      uses: 0,
      wins: 0,
      created_at: now,
      updated_at: now,
    });
  }

  // For wrong_output / spec_violation, also emit a `verifier_hint` so future plans get tighter checks.
  if (c.failure_mode === "wrong_output" || c.failure_mode === "spec_violation") {
    teachings.push({
      schema_version: "0.1",
      teaching_id: newId("tch"),
      origin_failure_cluster_id: c.cluster_id,
      type: "verifier_hint",
      verifier_kind: "exec",
      config_patch: {
        predicate: c.label.includes("join") ? "sql_must_contain" : "sql_must_not_contain",
        tokens: tokensForMode(c.failure_mode, c.label, errMsg),
      },
      scope: { keywords, task_modality: ["code"] },
      confidence: 0.5,
      uses: 0,
      wins: 0,
      created_at: now,
      updated_at: now,
    });
  }

  return teachings;
}

function patchForCluster(c: FailureCluster): PatchCandidate[] {
  const now = nowIso();
  const out: PatchCandidate[] = [];

  // prompt_patch: append a system-prefix directive derived from the cluster signature.
  out.push({
    schema_version: "0.1",
    patch_id: newId("pat"),
    origin_cluster_id: c.cluster_id,
    type: "prompt_patch",
    target_role: "system",
    diff: `+ ${promptDirectiveFor(c)}`,
    expected_delta: { pass_rate: 0.2, cost_usd: 0, latency_ms: 0 },
    replay_summary_id: null,
    status: "proposed",
    created_at: now,
  });

  // For cost_overrun / refusal — propose a routing_rule that swaps to a stronger model.
  if (c.failure_mode === "cost_overrun" || c.failure_mode === "refusal") {
    out.push({
      schema_version: "0.1",
      patch_id: newId("pat"),
      origin_cluster_id: c.cluster_id,
      type: "routing_rule",
      when: { failure_mode: c.failure_mode },
      choose_model: c.failure_mode === "refusal" ? "claude-opus-4-7" : "claude-haiku-4-5",
      expected_delta: { pass_rate: 0.1, cost_usd: c.failure_mode === "cost_overrun" ? -0.2 : 0.05, latency_ms: 0 },
      replay_summary_id: null,
      status: "proposed",
      created_at: now,
    });
  }

  return out;
}

function extractErrorText(t: Trace | null): string {
  if (!t) return "";
  const err = t.events.find((e) => e.kind === "error") as Extract<Event, { kind: "error" }> | undefined;
  if (err) return err.message;
  const v = t.events.find((e) => e.kind === "verifier_run" && !e.passed) as
    | Extract<Event, { kind: "verifier_run" }>
    | undefined;
  return v?.detail ?? "";
}

function rightForMode(mode: FailureCluster["failure_mode"], err: string): string {
  switch (mode) {
    case "wrong_output":
      return err.includes("column")
        ? "Use only columns from the provided schema; never invent column names."
        : "Verify the output against the expected schema before returning.";
    case "spec_violation":
      return "Read the task constraints again and ensure each requirement appears in the answer.";
    case "tool_misuse":
      return "Use the tool's documented arguments only; consult tool_doc before calling.";
    case "cost_overrun":
      return "Cap reasoning to the budget; degrade model rather than exceed.";
    case "loop":
      return "Stop and ask for clarification after 3 unsuccessful attempts.";
    case "refusal":
      return "If safety blocks the literal request, propose the closest compliant alternative.";
    default:
      return "Re-read the task and ensure the output is well-formed.";
  }
}

function policyRuleForMode(mode: FailureCluster["failure_mode"], err: string): string {
  if (mode === "tool_misuse") return "Call a tool only with arguments listed in its schema.";
  return err.includes("join")
    ? "Every multi-table query must use an explicit JOIN with an ON clause."
    : "Cross-check every required field appears in the structured output.";
}

function tokensForMode(mode: FailureCluster["failure_mode"], label: string, err: string): string[] {
  if (label.includes("join")) return ["join", "on"];
  if (err.toLowerCase().includes("aggregate")) return ["sum(", "avg("];
  return ["select"];
}

function promptDirectiveFor(c: FailureCluster): string {
  switch (c.failure_mode) {
    case "wrong_output":
      return "Before answering, list each required output field and confirm it is grounded in the input. Never invent identifiers.";
    case "spec_violation":
      return "Re-read every constraint in the task; produce a one-line checklist before the final answer.";
    case "tool_misuse":
      return "Use each tool exactly per its schema; if uncertain, ask before calling.";
    case "cost_overrun":
      return "Stay within the budget. If reasoning is approaching the cap, summarize and conclude.";
    case "loop":
      return "Stop iterating after 3 unsuccessful attempts and request clarification.";
    case "refusal":
      return "If the literal request is blocked, offer the closest compliant alternative explicitly.";
    default:
      return "Re-read the task carefully before producing the final output.";
  }
}

// ─── generate-evals: cluster → EvalCase[] ───────────────────────────────────
export interface EvalGenResult {
  evals: EvalCase[];
}

export function generateEvals(
  db: DB,
  opts: { cluster_ids?: string[] | null; max_per_cluster?: number } = {},
): EvalGenResult {
  const max = opts.max_per_cluster ?? 3;
  const clusters: FailureCluster[] = opts.cluster_ids
    ? (opts.cluster_ids.map((id) => getCluster(db, id)).filter(Boolean) as FailureCluster[])
    : listClusters(db);

  const out: EvalCase[] = [];
  for (const c of clusters) {
    const exemplar = getTrace(db, c.exemplar_trace_id);
    if (!exemplar) continue;
    const members = c.trace_ids
      .slice(0, max)
      .map((id) => getTrace(db, id))
      .filter(Boolean) as Trace[];
    const seen = new Set<string>();
    for (const m of members) {
      const inputs = extractInputs(m);
      const key = JSON.stringify(inputs);
      if (seen.has(key)) continue;
      seen.add(key);
      const grader = graderForCluster(c);
      const expected = expectedForCluster(c, m);
      const ev: EvalCase = {
        schema_version: "0.1",
        eval_id: newId("evl"),
        source_cluster_id: c.cluster_id,
        inputs,
        expected,
        grader,
        tags: [c.failure_mode, c.label],
        created_at: nowIso(),
      };
      insertEval(db, ev);
      out.push(ev);
    }
  }
  return { evals: out };
}

function extractInputs(t: Trace): Record<string, unknown> {
  // For imported OpenAI-style traces we stored `messages`/`prompt` inside the task's `inputs`.
  // We can't always recover them from the trace alone, so fall back to the first model_call's output_excerpt context.
  const mc = t.events.find((e) => e.kind === "model_call") as
    | Extract<Event, { kind: "model_call" }>
    | undefined;
  return {
    trace_id: t.trace_id,
    last_model: mc?.model,
    excerpt: mc?.output_excerpt,
  };
}

function graderForCluster(c: FailureCluster): EvalCase["grader"] {
  if (c.label.includes("join"))
    return { kind: "exec", config: { predicate: "sql_must_contain", tokens: ["join", "on"] } };
  if (c.failure_mode === "wrong_output")
    return { kind: "llm_judge", config: { must_not_include: ["error", "no such column"], must_include: [] } };
  if (c.failure_mode === "cost_overrun")
    return { kind: "exec", config: { predicate: "sql_must_not_contain", tokens: ["timeout"] } };
  return { kind: "llm_judge", config: { must_not_include: ["error"], must_include: [] } };
}

function expectedForCluster(c: FailureCluster, t: Trace): string {
  return `Cluster "${c.label}" pattern: produce output that satisfies grader for ${c.failure_mode}`;
}
