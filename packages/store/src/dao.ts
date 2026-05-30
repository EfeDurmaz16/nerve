import type { DB } from "./db.js";
import type {
  TaskEnvelope,
  ComputePlan,
  ContextPack,
  TeachingObject,
  TeachingProgram,
  Trace,
  FailureCluster,
  EvalCase,
  PatchCandidate,
  Receipt,
} from "@nerve/ir";
import { hashJson } from "./hash.js";
import type { BenchmarkResult, CacheEntry, RequestTrace } from "@tokenops/core";

// ---------- tasks ----------
export const insertTask = (db: DB, t: TaskEnvelope): void => {
  db.prepare(
    `INSERT OR REPLACE INTO tasks(task_id, agent_id, intent, modality, risk_class, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.task_id, t.agent_id, t.intent, t.modality, t.risk_class, JSON.stringify(t), t.created_at);
};

export const getTask = (db: DB, id: string): TaskEnvelope | null => {
  const r = db.prepare("SELECT body FROM tasks WHERE task_id = ?").get(id) as { body: string } | undefined;
  return r ? (JSON.parse(r.body) as TaskEnvelope) : null;
};

// ---------- compute plans ----------
export const insertPlan = (db: DB, p: ComputePlan): void => {
  db.prepare(
    `INSERT INTO compute_plans(plan_id, task_id, primary_model, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(p.plan_id, p.task_id, p.model.primary, JSON.stringify(p), p.created_at);
};

export const getPlan = (db: DB, id: string): ComputePlan | null => {
  const r = db.prepare("SELECT body FROM compute_plans WHERE plan_id = ?").get(id) as
    | { body: string }
    | undefined;
  return r ? (JSON.parse(r.body) as ComputePlan) : null;
};

export const latestPlanForTask = (db: DB, taskId: string): ComputePlan | null => {
  const r = db
    .prepare("SELECT body FROM compute_plans WHERE task_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(taskId) as { body: string } | undefined;
  return r ? (JSON.parse(r.body) as ComputePlan) : null;
};

// ---------- context packs ----------
export const insertPack = (db: DB, p: ContextPack): void => {
  db.prepare(
    `INSERT INTO context_packs(pack_id, task_id, total_tokens, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(p.pack_id, p.task_id, p.total_tokens, JSON.stringify(p), p.created_at);
};

export const getPack = (db: DB, id: string): ContextPack | null => {
  const r = db.prepare("SELECT body FROM context_packs WHERE pack_id = ?").get(id) as
    | { body: string }
    | undefined;
  return r ? (JSON.parse(r.body) as ContextPack) : null;
};

// ---------- teachings ----------
export const insertTeaching = (db: DB, t: TeachingObject): void => {
  const kw = (t.scope.keywords ?? []).join(" ").toLowerCase();
  db.prepare(
    `INSERT OR REPLACE INTO teachings(teaching_id, type, origin_cluster_id, confidence, uses, wins, scope_keywords, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.teaching_id,
    t.type,
    t.origin_failure_cluster_id,
    t.confidence,
    t.uses,
    t.wins,
    kw,
    JSON.stringify(t),
    t.created_at,
    t.updated_at,
  );
};

export const listTeachings = (db: DB, opts: { limit?: number; type?: string } = {}): TeachingObject[] => {
  const limit = opts.limit ?? 500;
  const rows = opts.type
    ? (db.prepare("SELECT body FROM teachings WHERE type = ? LIMIT ?").all(opts.type, limit) as {
        body: string;
      }[])
    : (db.prepare("SELECT body FROM teachings LIMIT ?").all(limit) as { body: string }[]);
  return rows.map((r) => JSON.parse(r.body) as TeachingObject);
};

export const incrementTeachingUse = (db: DB, id: string, win: boolean): void => {
  db.prepare(
    `UPDATE teachings SET uses = uses + 1, wins = wins + ?, updated_at = ? WHERE teaching_id = ?`,
  ).run(win ? 1 : 0, new Date().toISOString(), id);
};

// ---------- teaching programs ----------
export const insertProgram = (db: DB, p: TeachingProgram): void => {
  db.prepare(
    `INSERT INTO teaching_programs(program_id, task_id, body, created_at) VALUES (?, ?, ?, ?)`,
  ).run(p.program_id, p.task_id, JSON.stringify(p), p.created_at);
};

export const getProgram = (db: DB, id: string): TeachingProgram | null => {
  const r = db.prepare("SELECT body FROM teaching_programs WHERE program_id = ?").get(id) as
    | { body: string }
    | undefined;
  return r ? (JSON.parse(r.body) as TeachingProgram) : null;
};

// ---------- traces ----------
export const insertTrace = (db: DB, t: Trace): void => {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO traces(trace_id, task_id, plan_id, outcome, cost_usd, latency_ms, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      t.trace_id,
      t.task_id,
      t.plan_id,
      t.outcome,
      t.cost_usd,
      t.latency_ms,
      JSON.stringify(t),
      t.created_at,
    );
    db.prepare("DELETE FROM trace_events WHERE trace_id = ?").run(t.trace_id);
    const ins = db.prepare(
      `INSERT INTO trace_events(trace_id, ord, kind, ts, body) VALUES (?, ?, ?, ?, ?)`,
    );
    t.events.forEach((e, i) => ins.run(t.trace_id, i, e.kind, e.ts, JSON.stringify(e)));
  });
  tx();
};

export const getTrace = (db: DB, id: string): Trace | null => {
  const r = db.prepare("SELECT body FROM traces WHERE trace_id = ?").get(id) as
    | { body: string }
    | undefined;
  return r ? (JSON.parse(r.body) as Trace) : null;
};

export const listTraces = (db: DB, opts: { outcome?: string; limit?: number } = {}): Trace[] => {
  const limit = opts.limit ?? 500;
  const rows = opts.outcome
    ? (db
        .prepare("SELECT body FROM traces WHERE outcome = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.outcome, limit) as { body: string }[])
    : (db
        .prepare("SELECT body FROM traces ORDER BY created_at DESC LIMIT ?")
        .all(limit) as { body: string }[]);
  return rows.map((r) => JSON.parse(r.body) as Trace);
};

export const countTraces = (db: DB): { total: number; failures: number } => {
  const total = (db.prepare("SELECT COUNT(*) as c FROM traces").get() as { c: number }).c;
  const failures = (
    db.prepare("SELECT COUNT(*) as c FROM traces WHERE outcome != 'success'").get() as { c: number }
  ).c;
  return { total, failures };
};

// ---------- failure clusters ----------
export const upsertCluster = (db: DB, c: FailureCluster): void => {
  db.prepare(
    `INSERT INTO failure_clusters(cluster_id, label, signature, failure_mode, frequency, cost_usd_total, body, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(signature) DO UPDATE SET
       frequency = excluded.frequency,
       cost_usd_total = excluded.cost_usd_total,
       last_seen = excluded.last_seen,
       body = excluded.body`,
  ).run(
    c.cluster_id,
    c.label,
    c.signature,
    c.failure_mode,
    c.frequency,
    c.cost_usd_total,
    JSON.stringify(c),
    c.first_seen,
    c.last_seen,
  );
};

export const listClusters = (db: DB, limit = 100): FailureCluster[] => {
  const rows = db
    .prepare("SELECT body FROM failure_clusters ORDER BY frequency DESC LIMIT ?")
    .all(limit) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body) as FailureCluster);
};

export const getCluster = (db: DB, id: string): FailureCluster | null => {
  const r = db.prepare("SELECT body FROM failure_clusters WHERE cluster_id = ?").get(id) as
    | { body: string }
    | undefined;
  return r ? (JSON.parse(r.body) as FailureCluster) : null;
};

// ---------- evals ----------
export const insertEval = (db: DB, e: EvalCase): void => {
  const input_hash = hashJson(e.inputs);
  db.prepare(
    `INSERT OR IGNORE INTO evals(eval_id, source_cluster_id, input_hash, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(e.eval_id, e.source_cluster_id, input_hash, JSON.stringify(e), e.created_at);
};

export const listEvals = (db: DB, opts: { cluster_id?: string; limit?: number } = {}): EvalCase[] => {
  const limit = opts.limit ?? 1000;
  const rows = opts.cluster_id
    ? (db
        .prepare("SELECT body FROM evals WHERE source_cluster_id = ? LIMIT ?")
        .all(opts.cluster_id, limit) as { body: string }[])
    : (db.prepare("SELECT body FROM evals LIMIT ?").all(limit) as { body: string }[]);
  return rows.map((r) => JSON.parse(r.body) as EvalCase);
};

// ---------- patches ----------
export const insertPatch = (db: DB, p: PatchCandidate): void => {
  db.prepare(
    `INSERT INTO patches(patch_id, type, origin_cluster_id, status, replay_summary_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.patch_id, p.type, p.origin_cluster_id, p.status, p.replay_summary_id, JSON.stringify(p), p.created_at);
};

export const updatePatchStatus = (
  db: DB,
  id: string,
  status: PatchCandidate["status"],
  replay_summary_id?: string,
): void => {
  if (replay_summary_id)
    db.prepare("UPDATE patches SET status = ?, replay_summary_id = ? WHERE patch_id = ?").run(
      status,
      replay_summary_id,
      id,
    );
  else db.prepare("UPDATE patches SET status = ? WHERE patch_id = ?").run(status, id);
  // Mutate stored body too, so retrieved patch reflects new status.
  const row = db.prepare("SELECT body FROM patches WHERE patch_id = ?").get(id) as
    | { body: string }
    | undefined;
  if (row) {
    const body = JSON.parse(row.body) as PatchCandidate;
    body.status = status;
    if (replay_summary_id) body.replay_summary_id = replay_summary_id;
    db.prepare("UPDATE patches SET body = ? WHERE patch_id = ?").run(JSON.stringify(body), id);
  }
};

export const listPatches = (db: DB, opts: { status?: string; limit?: number } = {}): PatchCandidate[] => {
  const limit = opts.limit ?? 200;
  const rows = opts.status
    ? (db
        .prepare("SELECT body FROM patches WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.status, limit) as { body: string }[])
    : (db.prepare("SELECT body FROM patches ORDER BY created_at DESC LIMIT ?").all(limit) as {
        body: string;
      }[]);
  return rows.map((r) => JSON.parse(r.body) as PatchCandidate);
};

export const getPatch = (db: DB, id: string): PatchCandidate | null => {
  const r = db.prepare("SELECT body FROM patches WHERE patch_id = ?").get(id) as
    | { body: string }
    | undefined;
  return r ? (JSON.parse(r.body) as PatchCandidate) : null;
};

// ---------- receipts ----------
export const insertReceipt = (db: DB, r: Receipt): void => {
  db.prepare(
    `INSERT INTO receipts(receipt_id, verb, task_id, inputs_hash, outputs_hash, cost_usd, latency_ms, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.receipt_id, r.verb, r.task_id, r.inputs_hash, r.outputs_hash, r.cost_usd, r.latency_ms, r.ts);
};

export const getReceipt = (db: DB, id: string): Receipt | null => {
  const row = db.prepare("SELECT * FROM receipts WHERE receipt_id = ?").get(id) as
    | (Receipt & Record<string, unknown>)
    | undefined;
  if (!row) return null;
  return {
    schema_version: "0.1",
    receipt_id: row.receipt_id,
    verb: row.verb as Receipt["verb"],
    task_id: (row.task_id as string | null) ?? null,
    inputs_hash: row.inputs_hash as string,
    outputs_hash: row.outputs_hash as string,
    cost_usd: row.cost_usd as number,
    latency_ms: row.latency_ms as number,
    ts: row.ts as string,
  };
};

// ---------- replay summaries ----------
export const insertReplaySummary = (
  db: DB,
  id: string,
  baseline: string,
  body: Record<string, unknown>,
): void => {
  db.prepare(
    `INSERT INTO replay_summaries(replay_id, baseline, body, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, baseline, JSON.stringify(body), new Date().toISOString());
};

// ---------- TokenOps request traces ----------
export const insertTokenOpsTrace = (db: DB, t: RequestTrace): void => {
  db.prepare(
    `INSERT OR REPLACE INTO tokenops_request_traces(
      id, timestamp, workload_type, user_id, agent_id, requested_model, selected_model,
      selected_provider, normalized_hash, final_response_source, baseline_cost_usd,
      optimized_cost_usd, estimated_savings_usd, body
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.timestamp,
    t.workloadType,
    t.userId ?? null,
    t.agentId ?? null,
    t.requestedModel,
    t.selectedModel,
    t.selectedProvider,
    t.normalizedHash,
    t.finalResponseSource,
    t.cost.estimatedBaselineCost,
    t.cost.estimatedOptimizedCost,
    t.cost.estimatedSavings,
    JSON.stringify(t),
  );
};

export const getTokenOpsTrace = (db: DB, id: string): RequestTrace | null => {
  const row = db.prepare("SELECT body FROM tokenops_request_traces WHERE id = ?").get(id) as
    | { body: string }
    | undefined;
  return row ? (JSON.parse(row.body) as RequestTrace) : null;
};

export const listTokenOpsTraces = (db: DB, opts: { limit?: number } = {}): RequestTrace[] => {
  const rows = db
    .prepare("SELECT body FROM tokenops_request_traces ORDER BY timestamp DESC LIMIT ?")
    .all(opts.limit ?? 500) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body) as RequestTrace);
};

// ---------- TokenOps cache entries ----------
export const upsertTokenOpsCacheEntry = <T = unknown>(db: DB, entry: CacheEntry<T>): void => {
  db.prepare(
    `INSERT INTO tokenops_cache_entries(
      key, type, request_hash, user_id, agent_id, safety_class, created_at, expires_at,
      hit_count, metadata, response
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      response = excluded.response,
      metadata = excluded.metadata,
      safety_class = excluded.safety_class,
      expires_at = excluded.expires_at`,
  ).run(
    entry.key,
    entry.type,
    entry.request_hash,
    (entry.metadata.user_id as string | null | undefined) ?? null,
    (entry.metadata.agent_id as string | null | undefined) ?? null,
    entry.safety_class,
    entry.created_at,
    entry.expires_at,
    entry.hit_count,
    JSON.stringify(entry.metadata),
    JSON.stringify(entry.response),
  );
};

export const getTokenOpsCacheEntry = <T = unknown>(db: DB, key: string): CacheEntry<T> | null => {
  const row = db.prepare("SELECT * FROM tokenops_cache_entries WHERE key = ?").get(key) as
    | {
        key: string;
        type: CacheEntry["type"];
        request_hash: string;
        safety_class: CacheEntry["safety_class"];
        created_at: string;
        expires_at: string | null;
        hit_count: number;
        metadata: string;
        response: string;
      }
    | undefined;
  if (!row) return null;
  return {
    key: row.key,
    type: row.type,
    request_hash: row.request_hash,
    response: JSON.parse(row.response) as T,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    created_at: row.created_at,
    expires_at: row.expires_at,
    hit_count: row.hit_count,
    safety_class: row.safety_class,
  };
};

export const listTokenOpsCacheEntriesByType = <T = unknown>(
  db: DB,
  type: CacheEntry["type"],
  limit = 1000,
): CacheEntry<T>[] => {
  const rows = db
    .prepare("SELECT * FROM tokenops_cache_entries WHERE type = ? ORDER BY created_at DESC LIMIT ?")
    .all(type, limit) as Array<{
      key: string;
      type: CacheEntry["type"];
      request_hash: string;
      safety_class: CacheEntry["safety_class"];
      created_at: string;
      expires_at: string | null;
      hit_count: number;
      metadata: string;
      response: string;
    }>;
  return rows.map((row) => ({
    key: row.key,
    type: row.type,
    request_hash: row.request_hash,
    response: JSON.parse(row.response) as T,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    created_at: row.created_at,
    expires_at: row.expires_at,
    hit_count: row.hit_count,
    safety_class: row.safety_class,
  }));
};

export const incrementTokenOpsCacheHit = (db: DB, key: string): void => {
  db.prepare("UPDATE tokenops_cache_entries SET hit_count = hit_count + 1 WHERE key = ?").run(key);
};

export const clearTokenOpsCache = (db: DB): void => {
  db.prepare("DELETE FROM tokenops_cache_entries").run();
};

export const clearTokenOpsCacheByType = (db: DB, type: CacheEntry["type"]): void => {
  db.prepare("DELETE FROM tokenops_cache_entries WHERE type = ?").run(type);
};

export const tokenOpsCacheStats = (db: DB): { entries: number; hits: number; byType: Record<string, number> } => {
  const entries = (db.prepare("SELECT COUNT(*) as c FROM tokenops_cache_entries").get() as { c: number }).c;
  const hits = (db.prepare("SELECT COALESCE(SUM(hit_count), 0) as c FROM tokenops_cache_entries").get() as { c: number }).c;
  const rows = db.prepare("SELECT type, COUNT(*) as c FROM tokenops_cache_entries GROUP BY type").all() as {
    type: string;
    c: number;
  }[];
  return { entries, hits, byType: Object.fromEntries(rows.map((r) => [r.type, r.c])) };
};

// ---------- TokenOps benchmark results ----------
export const insertTokenOpsBenchmarkResult = (db: DB, id: string, result: BenchmarkResult): void => {
  db.prepare("INSERT OR REPLACE INTO tokenops_benchmark_results(id, dataset, created_at, body) VALUES (?, ?, ?, ?)").run(
    id,
    result.dataset,
    new Date().toISOString(),
    JSON.stringify(result),
  );
};

export const listTokenOpsBenchmarkResults = (db: DB, limit = 100): BenchmarkResult[] => {
  const rows = db
    .prepare("SELECT body FROM tokenops_benchmark_results ORDER BY created_at DESC LIMIT ?")
    .all(limit) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body) as BenchmarkResult);
};
