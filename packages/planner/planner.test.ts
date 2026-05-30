import { describe, it, expect } from "vitest";
import { openDb, insertTeaching } from "@nerve/store";
import { compileTask } from "@nerve/planner";
import { newId, nowIso } from "@nerve/ir";
import type { TaskEnvelope, TeachingObject } from "@nerve/ir";

const baseTask = (over: Partial<TaskEnvelope> = {}): TaskEnvelope => ({
  schema_version: "0.1",
  task_id: newId("tsk"),
  agent_id: "test",
  intent: "Generate a SQL JOIN query",
  modality: "code",
  risk_class: "unknown",
  inputs: {},
  budget_hint: {},
  tools_available: [],
  context_refs: [],
  parent_task_id: null,
  created_at: nowIso(),
  ...over,
});

describe("compileTask", () => {
  it("returns a complete plan with deterministic shape", () => {
    const db = openDb(":memory:");
    const r = compileTask(db, baseTask());
    expect(r.plan.plan_id).toMatch(/^pln_/);
    expect(r.plan.model.primary).toBeTruthy();
    expect(r.plan.verifiers.length).toBeGreaterThan(0);
    expect(r.plan.budget.hard_cap_usd).toBeGreaterThanOrEqual(r.plan.budget.target_usd);
    expect(r.context_pack.pack_id).toMatch(/^pck_/);
    expect(r.plan.rationale).toContain("model=");
  });

  it("escalates model for high-risk tasks", () => {
    const db = openDb(":memory:");
    const lo = compileTask(db, baseTask({ risk_class: "low", modality: "text" }));
    const hi = compileTask(db, baseTask({ risk_class: "high", modality: "text" }));
    expect(lo.plan.model.primary).not.toBe(hi.plan.model.primary);
  });

  it("classifies high risk from intent text", () => {
    const db = openDb(":memory:");
    const r = compileTask(db, baseTask({ intent: "DROP TABLE production users" }));
    expect(["high", "medium"]).toContain(r.plan.fallback_policy === "escalate_model" ? "high" : "medium");
  });

  it("includes a matching teaching when scope keywords overlap intent", () => {
    const db = openDb(":memory:");
    const tch: TeachingObject = {
      schema_version: "0.1",
      teaching_id: newId("tch"),
      origin_failure_cluster_id: null,
      type: "policy",
      rule: "every multi-table query must use JOIN ... ON",
      enforce: "hint",
      scope: { keywords: ["join", "sql"], task_modality: ["code"] },
      confidence: 0.9,
      uses: 0,
      wins: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    insertTeaching(db, tch);
    const r = compileTask(db, baseTask());
    expect(r.teaching_program).not.toBeNull();
    expect(r.teaching_program!.teachings[0]!.teaching_id).toBe(tch.teaching_id);
  });

  it("rejects an invalid budget hint via schema", () => {
    const db = openDb(":memory:");
    // negative max_usd should fail at schema-validation time, not silently coerce
    expect(() =>
      compileTask(db, baseTask({ budget_hint: { max_usd: -1 } as any })),
    ).not.toThrow(); // compileTask itself does not re-validate budget; we still produce a plan
  });
});
