import { describe, it, expect } from "vitest";
import { openDb, insertTrace, insertPatch, upsertCluster, insertEval } from "@nerve/store";
import { mineAll } from "@nerve/miner";
import { learn, generateEvals } from "@nerve/learner";
import { replay } from "@nerve/replay";
import { newId, nowIso } from "@nerve/ir";
import type { Trace } from "@nerve/ir";

const failing = (msg: string): Trace => ({
  schema_version: "0.1",
  trace_id: newId("trc"),
  task_id: newId("tsk"),
  plan_id: null,
  outcome: "failure",
  events: [{ kind: "error", ts: nowIso(), code: "x", message: msg }],
  cost_usd: 0.001,
  latency_ms: 300,
  created_at: nowIso(),
});

describe("replay end-to-end", () => {
  it("shows pass-rate delta after applying a patch", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 5; i++) insertTrace(db, failing("no such column: x.y"));
    for (let i = 0; i < 5; i++) insertTrace(db, failing("missing join: cartesian product"));
    mineAll(db);
    const { patches } = learn(db, {});
    generateEvals(db, {});
    const r = replay(db, { patch_ids: patches.map((p) => p.patch_id), baseline: "current_policy" });
    expect(r.baseline.pass_rate).toBeGreaterThanOrEqual(0);
    expect(r.baseline.pass_rate).toBeLessThanOrEqual(1);
    // At least one candidate must improve pass_rate by ≥0.2 with zero regressions (MVP acceptance criterion 5).
    const hasWin = r.candidates.some(
      (c) => c.delta.pass_rate >= 0.2 && c.regressions.length === 0,
    );
    expect(hasWin).toBe(true);
  });
});
