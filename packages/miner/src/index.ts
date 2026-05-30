import type { DB } from "@nerve/store";
import { upsertCluster, listClusters, sha256 } from "@nerve/store";
import { listTraces } from "@nerve/store";
import { newId, nowIso } from "@nerve/ir";
import type { Trace, FailureCluster, Event } from "@nerve/ir";

// Heuristic signature: classify each failure into one of a small fixed set of
// coarse buckets so similar errors collapse into a single cluster. v0.2 augments
// with embeddings; the v0.1 bucketer works on the seeded SQL example and any
// log whose error text resembles natural-language failure descriptions.
export function signatureFor(trace: Trace): { mode: FailureCluster["failure_mode"]; key: string } {
  const errEv = trace.events.find((e) => e.kind === "error") as Extract<Event, { kind: "error" }> | undefined;
  const failedVerifier = trace.events.find((e) => e.kind === "verifier_run" && !e.passed) as
    | Extract<Event, { kind: "verifier_run" }>
    | undefined;

  const text = (errEv?.message ?? failedVerifier?.detail ?? "").toLowerCase();
  if (!text) return { mode: "other", key: `other|outcome:${trace.outcome}` };

  const bucket = bucketFor(text);
  const mode = modeForBucket(bucket);
  return { mode, key: `${mode}|${bucket}` };
}

type Bucket =
  | "schema_hallucination"
  | "missing_join"
  | "wrong_agg"
  | "tool_misuse"
  | "cost_overrun"
  | "loop"
  | "refusal"
  | "other";

function bucketFor(t: string): Bucket {
  if (/no such (column|table)|unknown column|hallucinat|invented|did you mean/.test(t))
    return "schema_hallucination";
  if (/missing join|cartesian|wrong join|no join clause/.test(t)) return "missing_join";
  if (/wrong aggregate|expected (avg|sum|min|max|count)|median requested/.test(t)) return "wrong_agg";
  if (/timeout|exceeded budget|over budget/.test(t)) return "cost_overrun";
  if (/loop|max iterations|stuck/.test(t)) return "loop";
  if (/refus|cannot help|i can't|i won't/.test(t)) return "refusal";
  if (/tool .*(invalid|unknown|misuse)/.test(t)) return "tool_misuse";
  return "other";
}

function modeForBucket(b: Bucket): FailureCluster["failure_mode"] {
  switch (b) {
    case "schema_hallucination":
    case "wrong_agg":
      return "wrong_output";
    case "missing_join":
      return "spec_violation";
    case "tool_misuse":
      return "tool_misuse";
    case "cost_overrun":
      return "cost_overrun";
    case "loop":
      return "loop";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function classifyMode(text: string): FailureCluster["failure_mode"] {
  const t = text.toLowerCase();
  if (/no such (column|table)|unknown column|hallucinat|invented/.test(t)) return "wrong_output";
  if (/missing join|cartesian|wrong join/.test(t)) return "spec_violation";
  if (/wrong (aggregate|aggregation)|sum vs|avg vs/.test(t)) return "wrong_output";
  if (/timeout|exceeded budget|over budget/.test(t)) return "cost_overrun";
  if (/loop|max iterations/.test(t)) return "loop";
  if (/refus|cannot help|i can't/.test(t)) return "refusal";
  if (/tool .*(invalid|unknown|misuse)/.test(t)) return "tool_misuse";
  return "other";
}

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9_\.\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const STOP = new Set([
  "the","and","for","with","into","from","this","that","was","not","null","error","failed",
  "expected","actual","but","you","your","are","has","have","got","line","row","col","query","sql",
]);

function topTerms(tokens: string[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t)
    .sort();
}

export interface MineReport {
  imported: number;
  failures: number;
  clusters: number;
  cluster_summaries: Array<{ label: string; mode: string; freq: number }>;
}

export function mineAll(db: DB, opts: { limit?: number } = {}): MineReport {
  const failures = listTraces(db, { outcome: "failure", limit: opts.limit ?? 1000 });
  // Buckets keyed by signature key.
  const buckets = new Map<string, { mode: FailureCluster["failure_mode"]; traces: Trace[] }>();
  for (const t of failures) {
    const { mode, key } = signatureFor(t);
    const b = buckets.get(key) ?? { mode, traces: [] };
    b.traces.push(t);
    buckets.set(key, b);
  }
  const now = nowIso();
  let count = 0;
  const summaries: MineReport["cluster_summaries"] = [];
  for (const [key, b] of buckets) {
    if (b.traces.length === 0) continue;
    const sig = sha256(key);
    const exemplar = b.traces[0]!;
    const label = humanLabel(key);
    const cluster: FailureCluster = {
      schema_version: "0.1",
      cluster_id: newId("clu"),
      label,
      signature: sig,
      trace_ids: b.traces.map((t) => t.trace_id).slice(0, 50),
      exemplar_trace_id: exemplar.trace_id,
      failure_mode: b.mode,
      frequency: b.traces.length,
      cost_usd_total: b.traces.reduce((s, t) => s + t.cost_usd, 0),
      first_seen: b.traces[b.traces.length - 1]!.created_at,
      last_seen: b.traces[0]!.created_at,
    };
    upsertCluster(db, cluster);
    count += 1;
    summaries.push({ label, mode: b.mode, freq: b.traces.length });
  }
  summaries.sort((a, b) => b.freq - a.freq);
  return {
    imported: failures.length,
    failures: failures.length,
    clusters: listClusters(db).length || count,
    cluster_summaries: summaries,
  };
}

function humanLabel(key: string): string {
  const parts = key.split("|");
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : key;
}
