import { describe, it, expect } from "vitest";
import { openDb, insertTrace, listClusters } from "@nerve/store";
import { mineAll, signatureFor } from "@nerve/miner";
import { newId, nowIso } from "@nerve/ir";
import type { Trace } from "@nerve/ir";

const failingTrace = (msg: string): Trace => ({
  schema_version: "0.1",
  trace_id: newId("trc"),
  task_id: newId("tsk"),
  plan_id: null,
  outcome: "failure",
  events: [{ kind: "error", ts: nowIso(), code: "x", message: msg }],
  cost_usd: 0,
  latency_ms: 0,
  created_at: nowIso(),
});

describe("signatureFor", () => {
  it("buckets schema hallucinations together", () => {
    const a = signatureFor(failingTrace("no such column: users.firstname"));
    const b = signatureFor(failingTrace("no such column: products.name (did you mean title?)"));
    expect(a.key).toBe(b.key);
    expect(a.mode).toBe("wrong_output");
  });

  it("separates missing_join from wrong_agg", () => {
    const j = signatureFor(failingTrace("missing join: cartesian product between users and orders"));
    const g = signatureFor(failingTrace("wrong aggregate function: expected AVG, got SUM"));
    expect(j.key).not.toBe(g.key);
    expect(j.mode).toBe("spec_violation");
    expect(g.mode).toBe("wrong_output");
  });
});

describe("mineAll", () => {
  it("collapses 3 patterns into 3 clusters", () => {
    const db = openDb(":memory:");
    const samples = [
      ...Array.from({ length: 4 }, () => failingTrace("no such column: x.y")),
      ...Array.from({ length: 3 }, () => failingTrace("missing join: cartesian product")),
      ...Array.from({ length: 2 }, () => failingTrace("wrong aggregate function expected AVG got SUM")),
    ];
    for (const t of samples) insertTrace(db, t);
    const r = mineAll(db);
    expect(r.clusters).toBe(3);
    const cs = listClusters(db);
    const labels = cs.map((c) => c.label).sort();
    expect(labels.length).toBe(3);
  });
});
