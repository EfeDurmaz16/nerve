import { readFileSync } from "node:fs";
import { newId, nowIso } from "@nerve/ir";
import type { Trace, TaskEnvelope, Event, Outcome } from "@nerve/ir";

export interface ImportResult {
  task: TaskEnvelope;
  trace: Trace;
}

/**
 * nerve-native JSONL: one JSON object per line, containing a full {task, trace} pair OR
 * a flat record we can normalize. We accept three shapes for v0.1 convenience:
 *
 *   1. { task: TaskEnvelope, trace: Trace }       — native
 *   2. { task: {...partial}, events: Event[], outcome?, cost_usd?, latency_ms? }  — flattened
 *   3. OpenAI-style { model, messages: [...], output: "...", failure?: "...", usd?, latency_ms? }
 */
export function importJsonl(path: string, opts: { agent_id?: string } = {}): ImportResult[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: ImportResult[] = [];
  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const result = normalize(obj, opts.agent_id ?? "imported");
    if (result) out.push(result);
  }
  return out;
}

function normalize(obj: any, agent_id: string): ImportResult | null {
  // Shape 1: native
  if (obj.task && obj.trace) return { task: obj.task, trace: obj.trace };

  // Shape 2: flattened
  if (obj.task && Array.isArray(obj.events)) {
    const task = ensureTask(obj.task, agent_id);
    const trace = synthTrace(task.task_id, obj);
    return { task, trace };
  }

  // Shape 3: OpenAI-style chat record (most common log shape in the wild)
  if (Array.isArray(obj.messages) || obj.prompt || obj.completion || obj.output) {
    const intent = extractIntent(obj);
    const task = ensureTask({ intent, inputs: extractInputs(obj), modality: detectModality(obj) }, agent_id);
    const trace = synthTrace(task.task_id, openaiTraceFields(obj));
    return { task, trace };
  }

  return null;
}

function ensureTask(partial: any, agent_id: string): TaskEnvelope {
  return {
    schema_version: "0.1",
    task_id: partial.task_id ?? newId("tsk"),
    agent_id: partial.agent_id ?? agent_id,
    intent: partial.intent ?? "(imported)",
    inputs: partial.inputs ?? {},
    modality: partial.modality ?? "text",
    risk_class: partial.risk_class ?? "unknown",
    budget_hint: partial.budget_hint ?? {},
    tools_available: partial.tools_available ?? [],
    context_refs: partial.context_refs ?? [],
    parent_task_id: partial.parent_task_id ?? null,
    created_at: partial.created_at ?? nowIso(),
  };
}

function synthTrace(task_id: string, src: any): Trace {
  const events: Event[] = Array.isArray(src.events) ? src.events : synthEvents(src);
  const cost_usd = Number(src.cost_usd ?? sumCost(events) ?? 0);
  const latency_ms = Number(src.latency_ms ?? estimateLatency(events) ?? 0);
  const outcome: Outcome = src.outcome ?? deriveOutcome(src, events);
  return {
    schema_version: "0.1",
    trace_id: src.trace_id ?? newId("trc"),
    task_id,
    plan_id: src.plan_id ?? null,
    outcome,
    events,
    cost_usd,
    latency_ms,
    created_at: src.created_at ?? nowIso(),
  };
}

function synthEvents(src: any): Event[] {
  const events: Event[] = [];
  const ts = nowIso();
  if (src.model || src.completion || src.output) {
    const output = String(src.completion ?? src.output ?? "");
    events.push({
      kind: "model_call",
      ts,
      model: String(src.model ?? "unknown"),
      prompt_hash: "",
      tokens_in: Number(src.tokens_in ?? src.prompt_tokens ?? 0),
      tokens_out: Number(src.tokens_out ?? src.completion_tokens ?? 0),
      latency_ms: Number(src.latency_ms ?? 0),
      usd: Number(src.usd ?? src.cost_usd ?? 0),
      output_excerpt: output.slice(0, 500),
    });
  }
  if (src.failure || src.error) {
    events.push({
      kind: "error",
      ts,
      code: "import_error",
      message: String(src.failure ?? src.error),
    });
  }
  return events;
}

function openaiTraceFields(obj: any) {
  return {
    model: obj.model,
    completion: obj.output ?? obj.completion,
    tokens_in: obj.usage?.prompt_tokens,
    tokens_out: obj.usage?.completion_tokens,
    usd: obj.usd ?? obj.cost_usd,
    latency_ms: obj.latency_ms,
    failure: obj.failure,
    outcome: obj.outcome,
  };
}

function extractIntent(obj: any): string {
  if (Array.isArray(obj.messages)) {
    const last = [...obj.messages].reverse().find((m: any) => m.role !== "system");
    if (last) return String(last.content ?? "").slice(0, 200) || "(imported)";
  }
  if (obj.prompt) return String(obj.prompt).slice(0, 200);
  return "(imported)";
}

function extractInputs(obj: any): Record<string, unknown> {
  return { messages: obj.messages ?? null, prompt: obj.prompt ?? null };
}

function detectModality(obj: any): TaskEnvelope["modality"] {
  const text = JSON.stringify(obj).toLowerCase();
  if (text.includes("```sql") || text.includes("select ") || text.includes("from ")) return "code";
  if (Array.isArray(obj.tools) || obj.tool_calls) return "tool_use";
  if (Array.isArray(obj.messages) && obj.messages.length > 2) return "multi_turn";
  return "text";
}

function sumCost(events: Event[]): number {
  return events.reduce((s, e) => s + (e.kind === "model_call" ? e.usd : 0), 0);
}

function estimateLatency(events: Event[]): number {
  return events.reduce(
    (s, e) => s + ((e.kind === "model_call" || e.kind === "tool_call") ? e.latency_ms : 0),
    0,
  );
}

function deriveOutcome(src: any, events: Event[]): Outcome {
  if (src.failure || src.error) return "failure";
  if (events.some((e) => e.kind === "error")) return "failure";
  if (events.some((e) => e.kind === "verifier_run" && !e.passed)) return "failure";
  return "success";
}
