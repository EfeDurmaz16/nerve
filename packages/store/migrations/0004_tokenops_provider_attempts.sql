-- Provider attempt ledger for TokenOps serving-path debugging and cost attribution.

CREATE TABLE IF NOT EXISTS tokenops_provider_attempts (
  id            TEXT PRIMARY KEY,
  trace_id      TEXT,
  request_hash  TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  ok            INTEGER NOT NULL,
  error         TEXT,
  latency_ms    INTEGER NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tokenops_provider_attempts_trace ON tokenops_provider_attempts(trace_id);
CREATE INDEX IF NOT EXISTS tokenops_provider_attempts_provider ON tokenops_provider_attempts(provider, created_at);
CREATE INDEX IF NOT EXISTS tokenops_provider_attempts_hash ON tokenops_provider_attempts(request_hash);
