# Budget Policy

The MVP budget firewall supports:

- per-request max estimated cost
- daily budget
- expensive-model controls
- downgrade when budget is low
- block when budget is exhausted
- verifier requirement for high-risk workloads

All decisions return an action, `allowed`, reason, and remaining budget when available.

## Runtime Configuration

The gateway reads local guardrails from environment variables:

```bash
TOKENOPS_MAX_REQUEST_COST_USD=0.01
TOKENOPS_DAILY_BUDGET_USD=2
TOKENOPS_BUDGET_WARN_THRESHOLD=0.8
TOKENOPS_BLOCK_ON_BUDGET_EXCEEDED=true
TOKENOPS_MAX_REQUESTS_PER_USER_PER_DAY=100
TOKENOPS_MAX_REQUESTS_PER_AGENT_PER_DAY=200
TOKENOPS_RATE_LIMIT_PER_MINUTE=30
TOKENOPS_AGENT_LOOP_MAX_REPEATS=6
```

Budget, quota, rate-limit, and loop-limit decisions run before provider execution. Blocks write traces with `finalResponseSource` set to `blocked`, so replay and provider-health reports can still account for avoided compute.

`GET /budget/status` returns the active local policy, estimated spend from the trace ledger, quota settings, and rate-limit settings.

`GET /rate-limit/status` returns the local in-memory limiter state for the current gateway process.

## Policy Simulation

Before tightening production guardrails, TokenOps can replay a proposed budget policy against stored traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts policy simulate \
  --daily-budget-usd 2 \
  --max-request-cost-usd 0.01
```

The HTTP API exposes the same control:

```bash
curl -sS -X POST http://127.0.0.1:8787/policy/simulate \
  -H 'content-type: application/json' \
  -d '{"policy":{"daily_budget_usd":2,"max_request_cost_usd":0.01}}'
```

The result reports allowed, blocked, downgraded, and verifier-required decisions, plus estimated baseline cost, simulated allowed cost, and avoided compute cost. This is intentionally trace-driven and deterministic; it is a rollout analysis tool, not a replacement for live policy enforcement.
