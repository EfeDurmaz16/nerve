/**
 * 30-line agent: calls nerve's /compile-task, "executes" the plan, then /record-trace.
 * Demonstrates the agent-facing primitive — no human dashboard required.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NerveClient } from "@nerve/sdk-ts";
import { newId, nowIso } from "@nerve/ir";
import type { TaskEnvelope, Trace } from "@nerve/ir";

const here = dirname(fileURLToPath(import.meta.url));
const task = JSON.parse(readFileSync(resolve(here, "task.json"), "utf8")) as Partial<TaskEnvelope>;

const client = new NerveClient({
  base_url: process.env.NERVE_URL ?? "http://127.0.0.1:7777",
  token: process.env.NERVE_TOKEN ?? "",
});

const envelope: TaskEnvelope = {
  schema_version: "0.1",
  task_id: newId("tsk"),
  agent_id: task.agent_id ?? "sql_agent_demo",
  intent: task.intent ?? "(unspecified)",
  inputs: task.inputs ?? {},
  modality: task.modality ?? "code",
  risk_class: task.risk_class ?? "unknown",
  budget_hint: task.budget_hint ?? {},
  tools_available: task.tools_available ?? [],
  context_refs: task.context_refs ?? [],
  parent_task_id: null,
  created_at: nowIso(),
};

console.log("→ POST /v1/compile-task");
const compiled = await client.compileTask(envelope);
console.log(`  model:        ${compiled.plan.model.primary} (fallback: ${compiled.plan.model.fallback.join(",")})`);
console.log(`  teachings:    ${compiled.teaching_program?.teachings.length ?? 0}`);
console.log(`  verifiers:    ${compiled.plan.verifiers.map((v) => v.kind).join(",")}`);
console.log(`  budget:       target=$${compiled.plan.budget.target_usd} cap=$${compiled.plan.budget.hard_cap_usd}`);
console.log(`  rationale:    ${compiled.plan.rationale}`);
console.log(`  receipt:      ${compiled.receipt_id}`);

// "Execute" the plan. In real life: call provider with plan.model.primary + assembled prompt.
// Here we synthesize an output that matches what the plan's teachings should have produced.
const usedTeachings = (compiled.teaching_program?.teachings.length ?? 0) > 0;
const output = usedTeachings
  ? "SELECT u.name, COUNT(*) FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.name"
  : "SELECT users.name, COUNT(*) FROM users, orders GROUP BY users.name";

console.log(`\n→ executed plan → output:\n  ${output}`);

const trace: Trace = {
  schema_version: "0.1",
  trace_id: newId("trc"),
  task_id: envelope.task_id,
  plan_id: compiled.plan.plan_id,
  outcome: usedTeachings ? "success" : "failure",
  events: [
    {
      kind: "model_call",
      ts: nowIso(),
      model: compiled.plan.model.primary,
      prompt_hash: "demo",
      tokens_in: 220,
      tokens_out: 60,
      latency_ms: 400,
      usd: 0.0009,
      output_excerpt: output,
    },
    {
      kind: "verifier_run",
      ts: nowIso(),
      verifier_kind: "exec",
      passed: usedTeachings,
      detail: usedTeachings ? "ok" : "missing join: cartesian product",
    },
  ],
  cost_usd: 0.0009,
  latency_ms: 400,
  created_at: nowIso(),
};

console.log("\n→ POST /v1/record-trace");
const recorded = await client.recordTrace(trace);
console.log(`  outcome:      ${recorded.outcome}`);
console.log(`  events:       ${recorded.accepted_events}`);
console.log(`  receipt:      ${recorded.receipt_id}`);
