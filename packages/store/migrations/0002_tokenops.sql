-- TokenOps serving-path persistence. All JSON columns hold validated TokenOps blobs.

CREATE TABLE IF NOT EXISTS tokenops_request_traces (
  id              TEXT PRIMARY KEY,
  timestamp       TEXT NOT NULL,
  workload_type   TEXT NOT NULL,
  user_id         TEXT,
  agent_id        TEXT,
  requested_model TEXT NOT NULL,
  selected_model  TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  final_response_source TEXT NOT NULL,
  baseline_cost_usd REAL NOT NULL,
  optimized_cost_usd REAL NOT NULL,
  estimated_savings_usd REAL NOT NULL,
  body            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tokenops_traces_ts ON tokenops_request_traces(timestamp);
CREATE INDEX IF NOT EXISTS tokenops_traces_user ON tokenops_request_traces(user_id, timestamp);
CREATE INDEX IF NOT EXISTS tokenops_traces_agent ON tokenops_request_traces(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS tokenops_traces_hash ON tokenops_request_traces(normalized_hash);

CREATE TABLE IF NOT EXISTS tokenops_cache_entries (
  key             TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  user_id         TEXT,
  agent_id        TEXT,
  safety_class    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT,
  hit_count       INTEGER NOT NULL DEFAULT 0,
  metadata        TEXT NOT NULL,
  response        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tokenops_cache_type ON tokenops_cache_entries(type);
CREATE INDEX IF NOT EXISTS tokenops_cache_hash ON tokenops_cache_entries(request_hash);
CREATE INDEX IF NOT EXISTS tokenops_cache_scope ON tokenops_cache_entries(user_id, agent_id);

CREATE TABLE IF NOT EXISTS tokenops_benchmark_results (
  id              TEXT PRIMARY KEY,
  dataset         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  body            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tokenops_benchmark_dataset ON tokenops_benchmark_results(dataset, created_at);
