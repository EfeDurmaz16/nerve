# Inference Runtime

TokenOps now has a local serving runtime between the policy/cache/router layer and provider adapters.

The runtime is deliberately small, but it covers the infrastructure mechanics that matter before adding distributed systems:

- concurrency admission
- bounded inference queue
- priority-aware foreground/background queueing
- provider circuit breaker
- provider timeout aborts
- in-flight request coalescing

## Runtime Flow

```text
Gateway
  -> policy/cache/router decision
  -> InferenceRuntime
     -> circuit breaker check
     -> in-flight coalescer
     -> bounded priority scheduler
     -> provider adapter
```

If two identical cache misses arrive concurrently, TokenOps shares the same in-flight provider call instead of burning duplicate compute. The second waiter is reported as `tokenops.runtime.coalesced = true`.

When the local queue is saturated, higher-priority foreground inference can run
before queued background work. Equal-priority jobs preserve FIFO order. Runtime
stats expose `scheduler.queuedByPriority` so local operators can see whether
background verification or refresh work is piling up behind user-facing calls.

If a `/v1/chat/completions` request includes `idempotency-key`, TokenOps stores the successful response in SQLite under the request hash. A retry with the same key and same request returns the stored JSON body or generated SSE body with `x-tokenops-idempotency-hit: true` and does not create another trace or provider call. A retry with the same key and a different request returns `409 idempotency_key_conflict`.

## Configuration

```bash
TOKENOPS_MAX_CONCURRENT_INFERENCE=8
TOKENOPS_MAX_INFERENCE_QUEUE=100
TOKENOPS_CIRCUIT_FAILURE_THRESHOLD=3
TOKENOPS_CIRCUIT_COOLDOWN_MS=30000
TOKENOPS_PROVIDER_TIMEOUT_MS=30000
```

`TOKENOPS_PROVIDER_TIMEOUT_MS` is enforced by the provider retry wrapper. OpenAI-compatible, Groq, and Ollama adapters pass the abort signal into `fetch`.

Gateway traces record `providerLatencyMs` for model calls and provider errors. SLO routing and provider-health reports use this field for p95 latency windows.

Provider attempts are stored separately in SQLite for fallback/retry debugging:

```text
GET /providers/attempts
GET /providers/attempts?trace=<trace_id>
```

The CLI equivalent is:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers attempts
```

## Runtime Stats

```text
GET /runtime/stats
```

Returns:

- scheduler max concurrency, queue length, admitted, rejected, completed
- scheduler queued counts by priority
- coalescer shared calls and coalesced waiters
- circuit breaker state by provider key

## Load Benchmark

Run a local concurrent runtime benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts load \
  --requests 40 \
  --concurrency 10 \
  --duplicate-ratio 0.5 \
  --provider-latency-ms 25
```

The benchmark generates concurrent OpenAI-style requests against the local runtime and mock provider. Duplicate prompts simulate repeated agent context and retry bursts. The output reports:

- total requests
- provider calls actually made
- coalesced responses
- avoided provider calls
- wall-clock time
- p50/p95 latency
- scheduler stats
- circuit state

The product-readiness proof also includes a deterministic priority scheduling
check showing that foreground inference jumps ahead of queued background work.

## Micro-Batching Benchmark

Run:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts batch \
  --requests 32 \
  --batch-size 8 \
  --batch-window-ms 5 \
  --per-batch-overhead-ms 20 \
  --per-item-latency-ms 2
```

This simulates provider-side batch economics without requiring a hosted vLLM or GPU server. The model is simple:

- baseline: each request pays fixed provider overhead plus per-item work
- batched: each batch pays fixed overhead once plus per-item work

The result reports baseline wall time, batched wall time, estimated latency reduction, number of batches, largest batch, and average batch size.

## Provider Throughput Benchmark

Run a deterministic mock provider benchmark:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput mock \
  --requests 24 \
  --concurrency 6 \
  --provider-latency-ms 5
```

Run a local Ollama benchmark:

```bash
ollama serve
ollama pull llama3.2

TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput ollama \
  --requests 8 \
  --concurrency 2 \
  --model llama3.2
```

Run a hosted Groq benchmark:

```bash
GROQ_API_KEY=... # or put it in .env

TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq \
  --requests 4 \
  --concurrency 2 \
  --model llama-3.3-70b-versatile
```

The benchmark runs provider calls through `InferenceRuntime` and reports:

- provider/model
- provider calls
- wall-clock time
- input/output/total tokens
- output tokens per second
- total tokens per second
- p50/p95 latency
- scheduler and circuit stats
- sample provider errors

The Ollama path checks `/api/tags` first. The Groq path checks `GROQ_API_KEY` from the environment or `.env`. If either provider is unavailable, the command exits successfully with `skipped: true`, a skip reason, and an expected command. This keeps local CI and laptops without provider setup from producing false failures.

## Product-Readiness Proof

Run:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof --include-groq
```

This produces a combined proof report at:

- `docs/experiments/tokenops-product-readiness-report.json`
- `docs/experiments/tokenops-product-readiness.md`

The report combines replay cost reduction, runtime coalescing, micro-batching, mock throughput, optional live Groq throughput, explicit pass/fail gates, and known gaps. It is intended as the fastest local answer to “what impact does TokenOps prove right now?”

## Current Scope

This is local process infrastructure. It is useful for development, local demos, and single-process deployments.

Future distributed versions should move admission state, circuit state, and in-flight dedupe coordination into Redis, a durable queue, or provider-side batch APIs.
