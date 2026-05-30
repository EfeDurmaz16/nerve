import { describe, it, expect } from "vitest";
import {
  TaskEnvelope,
  ComputePlan,
  TeachingObject,
  PatchCandidate,
  Trace,
  parseOrThrow,
  newId,
  nowIso,
} from "@nerve/ir";

describe("IR round-trips", () => {
  it("validates a minimal TaskEnvelope", () => {
    const t = parseOrThrow(TaskEnvelope, {
      schema_version: "0.1",
      task_id: newId("tsk"),
      agent_id: "a",
      intent: "x",
      modality: "text",
      created_at: nowIso(),
    });
    expect(t.risk_class).toBe("unknown");
    expect(t.tools_available).toEqual([]);
  });

  it("rejects unknown modality", () => {
    expect(() =>
      parseOrThrow(TaskEnvelope, {
        schema_version: "0.1",
        task_id: "tsk_x",
        agent_id: "a",
        intent: "x",
        modality: "video",
        created_at: nowIso(),
      }),
    ).toThrow();
  });

  it("discriminates teaching types", () => {
    const t = parseOrThrow(TeachingObject, {
      schema_version: "0.1",
      teaching_id: newId("tch"),
      origin_failure_cluster_id: null,
      type: "policy",
      rule: "do x",
      enforce: "hint",
      scope: {},
      confidence: 0.5,
      uses: 0,
      wins: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    expect(t.type).toBe("policy");
  });

  it("discriminates patch types", () => {
    const p = parseOrThrow(PatchCandidate, {
      schema_version: "0.1",
      patch_id: newId("pat"),
      origin_cluster_id: null,
      type: "routing_rule",
      when: {},
      choose_model: "claude-opus-4-7",
      expected_delta: { pass_rate: 0, cost_usd: 0, latency_ms: 0 },
      replay_summary_id: null,
      status: "proposed",
      created_at: nowIso(),
    });
    expect(p.type).toBe("routing_rule");
  });

  it("trace events are discriminated", () => {
    const tr = parseOrThrow(Trace, {
      schema_version: "0.1",
      trace_id: newId("trc"),
      task_id: newId("tsk"),
      plan_id: null,
      outcome: "failure",
      events: [
        { kind: "error", ts: nowIso(), code: "x", message: "no such column users.foo" },
      ],
      cost_usd: 0,
      latency_ms: 0,
      created_at: nowIso(),
    });
    expect(tr.events[0]!.kind).toBe("error");
  });
});
