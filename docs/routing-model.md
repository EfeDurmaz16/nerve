# Routing Model

The serving router compares requested model, workload type, complexity, risk, and budget decision.

Rules in the MVP:

- Safe docs/support/classification/extraction can downgrade to `gpt-5-mini`.
- High-risk workloads escalate weak requested models to `gpt-5.5`.
- Budget pressure can force downgrade or block.
- Cache hits bypass provider calls.

Every route records selected provider, selected model, original model, downgrade/escalation flags, and a reason string.

## Adaptive Routing

TokenOps can learn a local routing policy from request traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing policy
```

The learned policy groups traces by workload type, risk level, provider, and selected model. For each workload/risk bucket, it selects the lowest average optimized cost route with enough samples and an acceptable verifier pass-rate.

Enable runtime application:

```bash
TOKENOPS_ADAPTIVE_ROUTING=1 TOKENOPS_ROUTING_MIN_SAMPLES=2 pnpm --filter @nerve/server start
```

This is deliberately conservative:

- blocked traces are ignored
- routes below `minVerifierPassRate` are ignored
- high-risk workloads are bucketed separately
- the policy is trace-derived rules, not an RL or bandit optimizer

The runtime endpoint:

```text
GET /routing/policy
```

returns the currently learned local policy.

## SLO Routing

TokenOps can also learn provider SLO windows from local traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing slo
```

SLO routing evaluates each provider over a recent trace window:

- error rate
- p95 provider latency from `RequestTrace.providerLatencyMs`
- average optimized cost

Enable runtime SLO guard:

```bash
TOKENOPS_SLO_ROUTING=1 \
TOKENOPS_SLO_WINDOW_SIZE=100 \
TOKENOPS_SLO_MAX_ERROR_RATE=0.1 \
TOKENOPS_SLO_MAX_P95_LATENCY_MS=10000 \
TOKENOPS_PROVIDER=groq,mock \
pnpm --filter @nerve/server start
```

When the selected provider violates the local SLO window and a configured fallback provider is eligible, TokenOps rewrites the route before provider execution.

New gateway traces record `providerLatencyMs` from the actual provider response or provider-error elapsed time. Older traces without this field fall back to conservative estimated fields.

The HTTP endpoint:

```text
GET /routing/slo
```

returns the current provider SLO policy.

## Provider Health

TokenOps also scores provider health from traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers health
```

The HTTP endpoint:

```text
GET /providers/health
```

reports per-provider request count, blocked rate, verifier pass-rate, cache hit-rate, average optimized cost, and a normalized health score.
