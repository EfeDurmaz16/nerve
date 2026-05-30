-- nerve v0.1 schema. All JSON columns hold validated IR blobs.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  task_id        TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL,
  intent         TEXT NOT NULL,
  modality       TEXT NOT NULL,
  risk_class     TEXT NOT NULL,
  body           TEXT NOT NULL,            -- full TaskEnvelope JSON
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_agent_created ON tasks(agent_id, created_at);

CREATE TABLE IF NOT EXISTS compute_plans (
  plan_id        TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  primary_model  TEXT NOT NULL,
  body           TEXT NOT NULL,            -- full ComputePlan JSON
  created_at     TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(task_id)
);
CREATE INDEX IF NOT EXISTS plans_task ON compute_plans(task_id);

CREATE TABLE IF NOT EXISTS context_packs (
  pack_id        TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  total_tokens   INTEGER NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS packs_task ON context_packs(task_id);

CREATE TABLE IF NOT EXISTS teachings (
  teaching_id    TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  origin_cluster_id TEXT,
  confidence     REAL NOT NULL,
  uses           INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  scope_keywords TEXT,                     -- space-separated for FTS-lite LIKE
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS teachings_type ON teachings(type);
CREATE INDEX IF NOT EXISTS teachings_cluster ON teachings(origin_cluster_id);

CREATE TABLE IF NOT EXISTS teaching_programs (
  program_id     TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS traces (
  trace_id       TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  plan_id        TEXT,
  outcome        TEXT NOT NULL,
  cost_usd       REAL NOT NULL,
  latency_ms     INTEGER NOT NULL,
  body           TEXT NOT NULL,            -- full Trace JSON (events may be truncated; full in trace_events)
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS traces_task ON traces(task_id);
CREATE INDEX IF NOT EXISTS traces_outcome ON traces(outcome);

CREATE TABLE IF NOT EXISTS trace_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id       TEXT NOT NULL,
  ord            INTEGER NOT NULL,
  kind           TEXT NOT NULL,
  ts             TEXT NOT NULL,
  body           TEXT NOT NULL,
  FOREIGN KEY(trace_id) REFERENCES traces(trace_id)
);
CREATE INDEX IF NOT EXISTS te_trace ON trace_events(trace_id, ord);
CREATE INDEX IF NOT EXISTS te_kind ON trace_events(kind);

CREATE TABLE IF NOT EXISTS failure_clusters (
  cluster_id     TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  signature      TEXT NOT NULL UNIQUE,
  failure_mode   TEXT NOT NULL,
  frequency      INTEGER NOT NULL,
  cost_usd_total REAL NOT NULL,
  body           TEXT NOT NULL,
  first_seen     TEXT NOT NULL,
  last_seen      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evals (
  eval_id        TEXT PRIMARY KEY,
  source_cluster_id TEXT,
  input_hash     TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evals_cluster ON evals(source_cluster_id);
CREATE UNIQUE INDEX IF NOT EXISTS evals_dedup ON evals(source_cluster_id, input_hash);

CREATE TABLE IF NOT EXISTS patches (
  patch_id       TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  origin_cluster_id TEXT,
  status         TEXT NOT NULL,
  replay_summary_id TEXT,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patches_status ON patches(status);
CREATE INDEX IF NOT EXISTS patches_cluster ON patches(origin_cluster_id);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id     TEXT PRIMARY KEY,
  verb           TEXT NOT NULL,
  task_id        TEXT,
  inputs_hash    TEXT NOT NULL,
  outputs_hash   TEXT NOT NULL,
  cost_usd       REAL NOT NULL,
  latency_ms     INTEGER NOT NULL,
  ts             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_verb ON receipts(verb, ts);
CREATE INDEX IF NOT EXISTS receipts_task ON receipts(task_id);

CREATE TABLE IF NOT EXISTS replay_summaries (
  replay_id      TEXT PRIMARY KEY,
  baseline       TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
