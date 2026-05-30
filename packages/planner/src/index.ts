import type { DB } from "@nerve/store";
import {
  insertPack,
  insertPlan,
  insertProgram,
  insertTask,
  listTeachings,
  listPatches,
} from "@nerve/store";
import { newId, nowIso } from "@nerve/ir";
import type {
  TaskEnvelope,
  ComputePlan,
  ContextPack,
  TeachingObject,
  TeachingProgram,
  VerifierSpec,
  PatchCandidate,
} from "@nerve/ir";

// Deterministic v0.1 model table. Tuned per (risk × modality × budget tier).
// In v0.2 this becomes data-driven from `routing_rule` patches.
const MODEL_TABLE: Record<
  string,
  { primary: string; fallback: string[]; temperature: number; max_output_tokens: number }
> = {
  "low|text|cheap":      { primary: "claude-haiku-4-5", fallback: ["gpt-4o-mini"], temperature: 0.2, max_output_tokens: 1024 },
  "low|code|cheap":      { primary: "claude-haiku-4-5", fallback: ["gpt-4o-mini"], temperature: 0.1, max_output_tokens: 2048 },
  "low|tool_use|cheap":  { primary: "claude-haiku-4-5", fallback: ["gpt-4o-mini"], temperature: 0.1, max_output_tokens: 1024 },
  "low|multi_turn|cheap":{ primary: "claude-haiku-4-5", fallback: ["gpt-4o-mini"], temperature: 0.3, max_output_tokens: 2048 },
  "medium|text|cheap":   { primary: "claude-sonnet-4-6", fallback: ["gpt-4o"], temperature: 0.2, max_output_tokens: 2048 },
  "medium|code|cheap":   { primary: "claude-sonnet-4-6", fallback: ["gpt-4o"], temperature: 0.1, max_output_tokens: 4096 },
  "medium|tool_use|cheap": { primary: "claude-sonnet-4-6", fallback: ["gpt-4o"], temperature: 0.1, max_output_tokens: 2048 },
  "medium|multi_turn|cheap": { primary: "claude-sonnet-4-6", fallback: ["gpt-4o"], temperature: 0.3, max_output_tokens: 4096 },
  "high|text|cheap":     { primary: "claude-opus-4-7", fallback: ["claude-sonnet-4-6"], temperature: 0.2, max_output_tokens: 4096 },
  "high|code|cheap":     { primary: "claude-opus-4-7", fallback: ["claude-sonnet-4-6"], temperature: 0.1, max_output_tokens: 8192 },
  "high|tool_use|cheap": { primary: "claude-opus-4-7", fallback: ["claude-sonnet-4-6"], temperature: 0.1, max_output_tokens: 4096 },
  "high|multi_turn|cheap": { primary: "claude-opus-4-7", fallback: ["claude-sonnet-4-6"], temperature: 0.3, max_output_tokens: 8192 },
  "unknown|text|cheap":  { primary: "claude-haiku-4-5", fallback: ["claude-sonnet-4-6"], temperature: 0.2, max_output_tokens: 1024 },
  "unknown|code|cheap":  { primary: "claude-haiku-4-5", fallback: ["claude-sonnet-4-6"], temperature: 0.1, max_output_tokens: 2048 },
  "unknown|tool_use|cheap": { primary: "claude-haiku-4-5", fallback: ["claude-sonnet-4-6"], temperature: 0.1, max_output_tokens: 1024 },
  "unknown|multi_turn|cheap": { primary: "claude-haiku-4-5", fallback: ["claude-sonnet-4-6"], temperature: 0.3, max_output_tokens: 2048 },
};

function budgetTier(t: TaskEnvelope): "cheap" | "rich" {
  const max = t.budget_hint?.max_usd;
  return max != null && max < 0.05 ? "cheap" : "cheap"; // single tier for v0.1
}

function modelFor(t: TaskEnvelope, livePatches: PatchCandidate[]) {
  // routing_rule patches: first match wins.
  for (const p of livePatches) {
    if (p.type === "routing_rule" && p.status === "live") {
      const when = (p as Extract<PatchCandidate, { type: "routing_rule" }>).when;
      if ((when.modality === undefined || when.modality === t.modality) &&
          (when.risk_class === undefined || when.risk_class === t.risk_class)) {
        return {
          primary: (p as Extract<PatchCandidate, { type: "routing_rule" }>).choose_model,
          fallback: ["claude-sonnet-4-6"],
          temperature: 0.2,
          max_output_tokens: 2048,
        };
      }
    }
  }
  const key = `${t.risk_class}|${t.modality}|${budgetTier(t)}`;
  return MODEL_TABLE[key] ?? MODEL_TABLE["unknown|text|cheap"]!;
}

// Heuristic task classifier — used only when risk_class is "unknown".
function classifyRisk(t: TaskEnvelope): TaskEnvelope["risk_class"] {
  if (t.risk_class !== "unknown") return t.risk_class;
  const text = (t.intent + " " + JSON.stringify(t.inputs)).toLowerCase();
  if (/delete|drop|production|payment|charge|wire|prod|live/.test(text)) return "high";
  if (/refactor|migration|schema|deploy|api/.test(text)) return "medium";
  return "low";
}

// Heuristic context compiler — for v0.1, ContextPack reflects what the agent supplied via context_refs.
// It is not a RAG retrieval; that requires a vector store and is out of v0.1 scope.
function buildContextPack(task: TaskEnvelope): ContextPack {
  const chunks = task.context_refs.map((ref, i) => ({
    chunk_id: newId("chk"),
    source: ref,
    text: `(referenced) ${ref}`,
    tokens: 16,
    score: 1.0,
    reason: "pinned" as const,
  }));
  const total_tokens = chunks.reduce((s, c) => s + c.tokens, 0);
  return {
    schema_version: "0.1",
    pack_id: newId("pck"),
    task_id: task.task_id,
    chunks,
    total_tokens,
    compression_ratio: 1.0,
    policy_id: "pinned-only-v0",
    created_at: nowIso(),
  };
}

// Teaching selector: pick teachings whose scope.keywords overlap the task's intent, ranked by wins/uses.
function selectTeachings(task: TaskEnvelope, all: TeachingObject[]): TeachingObject[] {
  const intentText = (task.intent + " " + JSON.stringify(task.inputs)).toLowerCase();
  const scored = all
    .map((t) => {
      const keywords = t.scope.keywords ?? [];
      const modalityOk = !t.scope.task_modality || t.scope.task_modality.includes(task.modality);
      if (!modalityOk) return null;
      const overlap = keywords.filter((k) => intentText.includes(k.toLowerCase())).length;
      if (overlap === 0 && keywords.length > 0) return null;
      const winRate = t.uses > 0 ? t.wins / t.uses : 0;
      const score = overlap * 2 + winRate + t.confidence;
      return { t, score };
    })
    .filter((x): x is { t: TeachingObject; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return scored.map((s) => s.t);
}

function buildProgram(task: TaskEnvelope, teachings: TeachingObject[]): TeachingProgram | null {
  if (teachings.length === 0) return null;
  return {
    schema_version: "0.1",
    program_id: newId("prg"),
    task_id: task.task_id,
    teachings: teachings.map((t, i) => ({
      teaching_id: t.teaching_id,
      render_mode:
        t.type === "verifier_hint"
          ? ("verifier_config" as const)
          : t.type === "test"
            ? ("fewshot" as const)
            : ("system_prefix" as const),
      order: i,
    })),
    total_token_cost: teachings.length * 40,
    selection_rationale: `Selected ${teachings.length} teachings matching task scope (modality=${task.modality}, risk=${task.risk_class}).`,
    created_at: nowIso(),
  };
}

function verifiersFor(task: TaskEnvelope, teachings: TeachingObject[]): VerifierSpec[] {
  const specs: VerifierSpec[] = [];
  // Always a schema check if the agent declared an output_schema in inputs.
  if (task.inputs && "output_schema" in (task.inputs as object)) {
    const out = (task.inputs as { output_schema?: { required?: string[] } }).output_schema;
    specs.push({
      kind: "schema",
      config: { required: out?.required ?? [] },
      required: true,
    });
  }
  // Inject any verifier_hint teachings as additional verifiers.
  for (const t of teachings) {
    if (t.type === "verifier_hint") {
      specs.push({
        kind: t.verifier_kind as VerifierSpec["kind"],
        config: t.config_patch,
        required: false,
      });
    }
  }
  // Always include a permissive llm_judge as a soft check.
  specs.push({
    kind: "llm_judge",
    config: { must_not_include: ["error:"], must_include: [] },
    required: false,
  });
  return specs;
}

function budgetFor(task: TaskEnvelope, riskClass: TaskEnvelope["risk_class"]) {
  const cap = task.budget_hint?.max_usd ?? (riskClass === "high" ? 0.5 : 0.05);
  const target = Math.max(cap * 0.6, 0.005);
  const target_latency_ms = task.budget_hint?.max_latency_ms ?? (riskClass === "high" ? 30000 : 8000);
  return { target_usd: round6(target), hard_cap_usd: round6(cap), target_latency_ms };
}

function fallbackPolicyFor(riskClass: TaskEnvelope["risk_class"]): ComputePlan["fallback_policy"] {
  if (riskClass === "high") return "escalate_model";
  if (riskClass === "low") return "degrade_model";
  return "retry_same";
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ─── Public API ──────────────────────────────────────────────────────────────
export interface CompileResult {
  plan: ComputePlan;
  context_pack: ContextPack;
  teaching_program: TeachingProgram | null;
}

export function compileTask(db: DB, taskIn: TaskEnvelope): CompileResult {
  // Materialize the task (with classified risk) and persist it.
  const task: TaskEnvelope = { ...taskIn, risk_class: classifyRisk(taskIn) };
  insertTask(db, task);

  const allTeachings = listTeachings(db, { limit: 500 });
  const selected = selectTeachings(task, allTeachings);
  const program = buildProgram(task, selected);
  if (program) insertProgram(db, program);

  const pack = buildContextPack(task);
  insertPack(db, pack);

  const livePatches = listPatches(db, { status: "live" });
  const model = modelFor(task, livePatches);
  const budget = budgetFor(task, task.risk_class);
  const verifiers = verifiersFor(task, selected);
  const plan: ComputePlan = {
    schema_version: "0.1",
    plan_id: newId("pln"),
    task_id: task.task_id,
    model: model!,
    context_pack_id: pack.pack_id,
    teaching_program_id: program?.program_id ?? null,
    verifiers,
    budget,
    fallback_policy: fallbackPolicyFor(task.risk_class),
    cache_policy: { use_cache: true, ttl_s: 3600 },
    rationale: rationale(task, selected, model.primary, livePatches.length),
    created_at: nowIso(),
  };
  insertPlan(db, plan);
  return { plan, context_pack: pack, teaching_program: program };
}

function rationale(t: TaskEnvelope, teachings: TeachingObject[], model: string | undefined, livePatchCount: number): string {
  const parts = [
    `task.modality=${t.modality} risk=${t.risk_class}`,
    `model=${model}`,
    teachings.length > 0
      ? `teachings=[${teachings.map((x) => `${x.type}:${x.teaching_id.slice(-6)}`).join(",")}]`
      : "teachings=none",
    `live_patches=${livePatchCount}`,
  ];
  return parts.join(" | ");
}

export { selectTeachings, classifyRisk, modelFor };
