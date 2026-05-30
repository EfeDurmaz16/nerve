# Quickstart

Install:

```bash
pnpm install
```

Run tests:

```bash
pnpm test
pnpm typecheck
```

Start gateway:

```bash
TOKENOPS_PORT=8787 pnpm --filter @nerve/server start
```

Run with Groq as the real LLM provider:

```bash
GROQ_API_KEY=... \
TOKENOPS_PROVIDER=groq \
GROQ_MODEL=llama-3.3-70b-versatile \
TOKENOPS_PORT=8787 \
pnpm --filter @nerve/server start
```

Run with fallback providers:

```bash
TOKENOPS_PROVIDER=groq,ollama,mock \
GROQ_API_KEY=... \
TOKENOPS_PORT=8787 \
pnpm --filter @nerve/server start
```

The gateway tries providers left-to-right. If Groq is unavailable, it can fall back to local Ollama and then the deterministic mock provider.

Use an OpenAI-compatible client with:

```bash
OPENAI_BASE_URL=http://localhost:8787/v1
```

Smoke test:

```bash
curl -sS http://127.0.0.1:8787/health
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"docs quickstart"}]}'
curl -sS -X POST http://127.0.0.1:8787/v1/responses \
  -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","input":"docs quickstart"}'
curl -sS -X POST http://127.0.0.1:8787/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"model":"text-embedding-3-small","input":["TokenOps cache policy","Adaptive inference control plane"],"dimensions":32}'
```

Retry-safe chat completions can use `idempotency-key`. Reusing the same key with the same request returns the stored response and does not create another trace or provider call; reusing it with a different request returns `409`.

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-retry-1' \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"docs quickstart retry"}]}'
```

Run benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay benchmark/datasets/docs-qa.jsonl --persist
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts load --requests 40 --concurrency 10 --duplicate-ratio 0.5
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts batch --requests 32 --batch-size 8
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts failover --requests 12
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput mock --requests 24 --concurrency 6
```

Export or import local TokenOps evidence:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts export ./tokenops-snapshot.json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts import ./tokenops-snapshot.json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts prune --keep-traces 1000 --keep-benchmarks 100 --keep-idempotency 1000
```

Reconcile provider usage exports against the local trace ledger:

```bash
cat > ./provider-usage.jsonl <<'JSONL'
{"provider":"groq","model":"llama-3.3-70b-versatile","trace_id":"tr_example","request_hash":"hash_example","input_tokens":42,"output_tokens":4,"actual_cost_usd":0.001}
JSONL

TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts reconcile ./provider-usage.jsonl
```

Export traces to an OpenTelemetry-style JSONL file for downstream observability tools:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts traces export \
  --format otel \
  --out ./tokenops-spans.jsonl
```

For local model infra, run an availability-aware Ollama throughput check:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput ollama --requests 8 --concurrency 2 --model llama3.2
```

If Ollama is not running, this returns a skipped report with the expected `ollama serve` command.

For hosted inference throughput with the Groq key in `.env`:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq --requests 4 --concurrency 2
```

Run a provider failover benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts failover \
  --requests 12 \
  --primary-failures-before-success 12 \
  --circuit-failure-threshold 2
```

This opens the synthetic primary provider circuit after repeated failures and verifies fallback recovery without failed responses.

Generate a product-readiness proof report:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof --include-groq
```

This writes `docs/experiments/tokenops-product-readiness-report.json` and `docs/experiments/tokenops-product-readiness.md`.

Inspect the local setup:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts doctor
```

The doctor command reports git/remote status, `.env` ignore safety, provider configuration presence, proof readiness, and whether the gateway port is already occupied. It does not print provider keys.

Run a live direct-vs-gateway Groq comparison:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare groq
```

Run the same comparison for OpenAI:

```bash
OPENAI_API_KEY=... TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare openai
```

If `OPENAI_API_KEY` is missing, the command writes a skipped report instead of failing.

This writes:

- `docs/experiments/groq-live-comparison-report.json`
- `docs/experiments/groq-live-comparison.md`

Run verifier eval:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval --dataset benchmark/verifier/basic.jsonl
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify routing
```

Run semantic-cache safety eval:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts cache eval
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts cache eval --sweep --thresholds 0.2,0.3,0.5
```

`verify routing` checks cheap-then-verify escalation behavior. `cache eval` checks adversarial semantic-cache reuse cases and fails on unsafe cache hits or safe cache misses. Sweep mode compares thresholds and reports the recommended local threshold for the corpus.

Print the learned routing policy from local traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing policy
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing slo
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing slo-benchmark
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing arbitrage \
  --provider groq \
  --candidates groq,openai,mock
```

`routing slo-benchmark` uses synthetic provider traces to verify that an unhealthy provider is rerouted to an eligible fallback.

Enable provider arbitrage when you want TokenOps to pick the cheapest healthy
provider from recent traces before inference:

```bash
TOKENOPS_PROVIDER_ARBITRAGE=1 \
TOKENOPS_PROVIDER_CANDIDATES=groq,openai,mock \
TOKENOPS_PROVIDER_ARBITRAGE_MIN_HEALTH=0.8 \
TOKENOPS_PROVIDER_ARBITRAGE_MAX_P95_MS=1000 \
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts serve
```

Print provider health from local traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers health
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers attempts
```

Run Ollama smoke:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts smoke ollama
```

If local Ollama is not reachable, the command writes a skipped report instead of failing.

Enable trace-derived adaptive routing in the gateway:

```bash
TOKENOPS_ADAPTIVE_ROUTING=1 TOKENOPS_ROUTING_MIN_SAMPLES=2 pnpm --filter @nerve/server start
```

Enable SLO routing:

```bash
TOKENOPS_SLO_ROUTING=1 \
TOKENOPS_PROVIDER=groq,mock \
TOKENOPS_SLO_MAX_ERROR_RATE=0.1 \
TOKENOPS_SLO_MAX_P95_LATENCY_MS=10000 \
pnpm --filter @nerve/server start
```

Enable runtime compute guardrails:

```bash
TOKENOPS_MAX_REQUEST_COST_USD=0.01 \
TOKENOPS_DAILY_BUDGET_USD=2 \
TOKENOPS_MAX_REQUESTS_PER_USER_PER_DAY=100 \
TOKENOPS_RATE_LIMIT_PER_MINUTE=30 \
TOKENOPS_AGENT_LOOP_MAX_REPEATS=6 \
pnpm --filter @nerve/server start
```

These controls run before provider execution. Budget and quota blocks return an explainable error and still write a TokenOps trace. Provider errors also write a trace and return `x-tokenops-trace-id`.

For rollout analysis, shadow budget enforcement without blocking inference:

```bash
TOKENOPS_POLICY_MODE=shadow \
TOKENOPS_MAX_REQUEST_COST_USD=0.01 \
pnpm --filter @nerve/server start
```

Inspect policy state:

```bash
curl -sS http://127.0.0.1:8787/budget/status
curl -sS -X POST http://127.0.0.1:8787/policy/simulate \
  -H 'content-type: application/json' \
  -d '{"policy":{"daily_budget_usd":2,"max_request_cost_usd":0.01}}'
curl -sS http://127.0.0.1:8787/rate-limit/status
curl -sS http://127.0.0.1:8787/runtime/stats
```

You can run the same simulation directly from the local trace ledger:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts policy simulate \
  --daily-budget-usd 2 \
  --max-request-cost-usd 0.01
```

Tune the local inference runtime:

```bash
TOKENOPS_MAX_CONCURRENT_INFERENCE=8 \
TOKENOPS_MAX_INFERENCE_QUEUE=100 \
TOKENOPS_CIRCUIT_FAILURE_THRESHOLD=3 \
TOKENOPS_CIRCUIT_COOLDOWN_MS=30000 \
TOKENOPS_PROVIDER_TIMEOUT_MS=30000 \
pnpm --filter @nerve/server start
```

Run replay through the HTTP API:

```bash
curl -sS -X POST http://127.0.0.1:8787/replay \
  -H 'content-type: application/json' \
  -d '{"dataset":"benchmark/datasets/docs-qa.jsonl"}'
curl -sS http://127.0.0.1:8787/benchmark/results
```

Run demo:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts demo
```
