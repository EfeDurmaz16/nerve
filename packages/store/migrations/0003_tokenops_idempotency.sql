-- TokenOps idempotency records for retry-safe gateway calls.

CREATE TABLE IF NOT EXISTS tokenops_idempotency_records (
  route         TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  trace_id      TEXT,
  response_body TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY(route, key)
);

CREATE INDEX IF NOT EXISTS tokenops_idempotency_created ON tokenops_idempotency_records(created_at);
