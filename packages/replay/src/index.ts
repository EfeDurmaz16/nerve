import type { DB } from "@nerve/store";
import {
  getPatch,
  listEvals,
  insertReplaySummary,
  updatePatchStatus,
  getCluster,
} from "@nerve/store";
import { newId, nowIso } from "@nerve/ir";
import type { EvalCase, PatchCandidate, FailureCluster } from "@nerve/ir";
import { gradeOutput } from "@nerve/verifiers";

// ─── Simulated model ─────────────────────────────────────────────────────────
// nerve v0.1 does not require a real LLM key to demo the loop. We simulate output
// from the failure cluster's signature, then mutate based on which patches are active.
// The simulation is honest: a patch only "helps" if it injects something that flips
// the grader pass/fail check. That's the same gate a real eval would apply.
//
// Cost/latency model: derived from a tiny table by model id.

const MODEL_COST: Record<string, { usd_per_1k_in: number; usd_per_1k_out: number; latency_ms_base: number }> = {
  "claude-haiku-4-5": { usd_per_1k_in: 0.0008, usd_per_1k_out: 0.004, latency_ms_base: 350 },
  "claude-sonnet-4-6": { usd_per_1k_in: 0.003, usd_per_1k_out: 0.015, latency_ms_base: 700 },
  "claude-opus-4-7": { usd_per_1k_in: 0.015, usd_per_1k_out: 0.075, latency_ms_base: 1500 },
  "gpt-4o-mini": { usd_per_1k_in: 0.0001, usd_per_1k_out: 0.0006, latency_ms_base: 400 },
  "gpt-4o": { usd_per_1k_in: 0.003, usd_per_1k_out: 0.01, latency_ms_base: 800 },
};

interface SimulatedRun {
  output: string;
  cost_usd: number;
  latency_ms: number;
}

function simulate(
  db: DB,
  ev: EvalCase,
  patches: PatchCandidate[],
  model: string,
): SimulatedRun {
  // Baseline output reproduces the failure mode named by the cluster.
  const cluster = ev.source_cluster_id ? getCluster(db, ev.source_cluster_id) : null;
  let output = baselineOutput(cluster);

  // Apply each active patch in order. Patches *narrow* the output toward correctness.
  for (const p of patches) {
    output = applyPatch(output, p, cluster);
  }

  const tokens_in = 200;
  const tokens_out = output.length / 4;
  const m = MODEL_COST[model] ?? MODEL_COST["claude-haiku-4-5"]!;
  const cost_usd =
    (tokens_in / 1000) * m.usd_per_1k_in + (tokens_out / 1000) * m.usd_per_1k_out;
  const latency_ms = m.latency_ms_base + Math.round(tokens_out * 0.5);
  return { output, cost_usd: round6(cost_usd), latency_ms };
}

function baselineOutput(cluster: FailureCluster | null): string {
  if (!cluster) return "SELECT 1";
  switch (cluster.failure_mode) {
    case "wrong_output":
      if (cluster.label.includes("join")) return "SELECT name FROM orders WHERE id = 1"; // missing join hint
      return "SELECT users.first_name FROM customers WHERE id = 1"; // hallucinated column
    case "spec_violation":
      return "SELECT * FROM users, orders WHERE id = 1"; // cartesian, no JOIN ... ON
    case "cost_overrun":
      return "TIMEOUT: exceeded budget";
    case "tool_misuse":
      return "tool_call({invalid_arg: true})";
    case "refusal":
      return "I cannot help with that.";
    case "loop":
      return "RETRY 17 — still failing.";
    default:
      return "ERROR: unspecified failure";
  }
}

function applyPatch(output: string, p: PatchCandidate, c: FailureCluster | null): string {
  if (p.type === "prompt_patch") {
    // System directive injection: agent re-reads constraints, producing a corrected query.
    if (p.diff.includes("checklist") || p.diff.includes("constraints"))
      return correctOutputFor(c);
    if (p.diff.includes("ground") || p.diff.includes("invent"))
      return correctOutputFor(c);
    return output;
  }
  if (p.type === "verifier_rule") return output; // verifier rules affect grading, not the model
  if (p.type === "routing_rule") {
    if (output.includes("TIMEOUT")) return correctOutputFor(c); // bigger budget on stronger model
    return output;
  }
  if (p.type === "teaching_program") return correctOutputFor(c);
  return output;
}

function correctOutputFor(c: FailureCluster | null): string {
  if (!c) return "SELECT 1";
  switch (c.failure_mode) {
    case "wrong_output":
      if (c.label.includes("join"))
        return "SELECT u.name FROM users u JOIN orders o ON o.user_id = u.id WHERE o.id = 1";
      return "SELECT first_name FROM users WHERE id = 1";
    case "spec_violation":
      return "SELECT * FROM users u JOIN orders o ON o.user_id = u.id WHERE u.id = 1";
    case "cost_overrun":
      return "SELECT COUNT(*) FROM users";
    case "tool_misuse":
      return "tool_call({arg: \"valid\"})";
    case "refusal":
      return "Here is a compliant alternative: ...";
    case "loop":
      return "Asking for clarification.";
    default:
      return "ok";
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ─── Public API ──────────────────────────────────────────────────────────────
export interface ReplayCandidateReport {
  patch_id: string;
  pass_rate: number;
  cost_usd: number;
  latency_ms_p50: number;
  delta: { pass_rate: number; cost_usd: number; latency_ms: number };
  regressions: string[]; // eval_ids that pass under baseline but fail under candidate
}

export interface ReplayReport {
  replay_id: string;
  baseline: { pass_rate: number; cost_usd: number; latency_ms_p50: number };
  candidates: ReplayCandidateReport[];
  evals_run: number;
}

export interface ReplayInput {
  patch_ids: string[];
  baseline: "current_policy" | string;
  eval_ids?: string[] | null;
  sample?: number;
}

export function replay(db: DB, input: ReplayInput): ReplayReport {
  const evalsAll = input.eval_ids
    ? (input.eval_ids.map((id) => findEval(db, id)).filter(Boolean) as EvalCase[])
    : listEvals(db, { limit: input.sample ?? 1000 });
  const evs = evalsAll.slice(0, input.sample ?? evalsAll.length);

  // Baseline = current policy = NO patches (or live patches if baseline="current_policy"
  // is interpreted as the currently-live set). For v0.1 we treat baseline as zero patches
  // so the delta numerically reflects "before any approval" vs each candidate.
  const baselineRuns = evs.map((e) =>
    simulate(db, e, [], "claude-haiku-4-5"),
  );
  const baseGrades = evs.map((e, i) =>
    gradeOutput(e.inputs, baselineRuns[i]!.output, e.expected, e.grader),
  );
  const baseline = aggregate(baseGrades, baselineRuns);

  const candidates: ReplayCandidateReport[] = [];
  for (const pid of input.patch_ids) {
    const patch = getPatch(db, pid);
    if (!patch) continue;
    const candidateRuns = evs.map((e) =>
      simulate(db, e, [patch], chooseModel(patch)),
    );
    const candidateGrades = evs.map((e, i) =>
      gradeOutput(e.inputs, candidateRuns[i]!.output, e.expected, e.grader),
    );
    const candidateAgg = aggregate(candidateGrades, candidateRuns);
    const regressions: string[] = [];
    for (let i = 0; i < evs.length; i++) {
      if (baseGrades[i]!.passed && !candidateGrades[i]!.passed) regressions.push(evs[i]!.eval_id);
    }
    candidates.push({
      patch_id: pid,
      pass_rate: candidateAgg.pass_rate,
      cost_usd: candidateAgg.cost_usd,
      latency_ms_p50: candidateAgg.latency_ms_p50,
      delta: {
        pass_rate: round6(candidateAgg.pass_rate - baseline.pass_rate),
        cost_usd: round6(candidateAgg.cost_usd - baseline.cost_usd),
        latency_ms: candidateAgg.latency_ms_p50 - baseline.latency_ms_p50,
      },
      regressions,
    });
  }

  const replay_id = newId("rep");
  const summary = {
    replay_id,
    baseline,
    candidates,
    evals_run: evs.length,
    created_at: nowIso(),
  };
  insertReplaySummary(db, replay_id, input.baseline, summary);
  // Decorate each patch with replay_summary_id for the review gate.
  for (const c of candidates) updatePatchStatus(db, c.patch_id, "proposed", replay_id);
  return { replay_id, baseline, candidates, evals_run: evs.length };
}

function findEval(db: DB, id: string): EvalCase | null {
  const all = listEvals(db, { limit: 5000 });
  return all.find((e) => e.eval_id === id) ?? null;
}

function chooseModel(p: PatchCandidate): string {
  if (p.type === "routing_rule") return (p as Extract<PatchCandidate, { type: "routing_rule" }>).choose_model;
  return "claude-haiku-4-5";
}

function aggregate(
  grades: { passed: boolean }[],
  runs: SimulatedRun[],
): { pass_rate: number; cost_usd: number; latency_ms_p50: number } {
  const passed = grades.filter((g) => g.passed).length;
  const pass_rate = grades.length === 0 ? 0 : passed / grades.length;
  const cost_usd = round6(runs.reduce((s, r) => s + r.cost_usd, 0));
  const lat = [...runs.map((r) => r.latency_ms)].sort((a, b) => a - b);
  const latency_ms_p50 = lat.length === 0 ? 0 : lat[Math.floor(lat.length / 2)]!;
  return { pass_rate: round6(pass_rate), cost_usd, latency_ms_p50 };
}
