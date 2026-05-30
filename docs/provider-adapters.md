# Provider Adapters

Provider interface:

```ts
interface ModelProvider {
  name: string;
  complete(request: NormalizedRequest): Promise<ModelResponse>;
  estimateCost?(request: NormalizedRequest): CostEstimate;
}
```

Implemented:

- `MockProvider`: deterministic local provider for tests, replay, and demo.
- `GroqProvider`: OpenAI-compatible chat completions over `https://api.groq.com/openai/v1/chat/completions`.
- `OpenAIProvider`: OpenAI-compatible chat completions over `https://api.openai.com/v1/chat/completions`.
- `OllamaProvider`: local chat completions over `http://localhost:11434/api/chat`.
- `FallbackProvider`: tries a configured provider chain in order and records failed providers in response metadata.
- `RetryProvider`: wraps providers with bounded retry and timeout behavior.

Scaffolded:

- Anthropic
- Gemini
- vLLM

Real adapters intentionally fail clearly until configured and implemented. They must not log provider API keys, auth headers, raw credentials, or sensitive request payloads.

## Groq

Groq is the first real provider path.

```bash
GROQ_API_KEY=... \
TOKENOPS_PROVIDER=groq \
GROQ_MODEL=llama-3.3-70b-versatile \
TOKENOPS_PORT=8787 \
pnpm --filter @nerve/server start
```

Then call TokenOps through the same OpenAI-compatible local endpoint:

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Say hello from the real provider"}]}'
```

If `TOKENOPS_PROVIDER` is unset but `GROQ_API_KEY` exists, the server selects Groq automatically. If neither is present, it uses `MockProvider`.

The Groq adapter is implemented with direct HTTP `fetch`, not an SDK dependency. It follows Groq's OpenAI-compatible API shape: base URL `https://api.groq.com/openai/v1`, endpoint `/chat/completions`.

Hosted throughput check:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq \
  --requests 4 \
  --concurrency 2 \
  --model llama-3.3-70b-versatile
```

The CLI loads `.env`, so a local `GROQ_API_KEY=...` file is enough. If the key is missing, the command returns `skipped: true` with an actionable reason.

## Fallback Chains

Set a comma-separated provider list:

```bash
TOKENOPS_PROVIDER=groq,ollama,mock
```

The gateway attempts providers left-to-right. If the selected provider differs from the configured chain, the request trace records the effective provider and annotates the routing reason with the fallback decision.

Each serving-path provider attempt is also written to `tokenops_provider_attempts`. This gives a separate operational ledger for fallback and retry debugging without parsing full request traces.

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers attempts
curl -sS http://127.0.0.1:8787/providers/attempts
```

Provider calls are wrapped with retry and timeout controls:

```bash
TOKENOPS_PROVIDER_RETRIES=1
TOKENOPS_PROVIDER_TIMEOUT_MS=30000
```

If all provider attempts fail, the gateway returns `502`, includes `x-tokenops-trace-id`, and records a `provider_error` trace. Retry timeouts bound gateway latency and pass `AbortSignal` into OpenAI-compatible, Groq, and Ollama fetch calls.

Repeated provider failures trip the local circuit breaker when `TOKENOPS_CIRCUIT_FAILURE_THRESHOLD` is reached. While open, the gateway fails fast instead of repeatedly burning sockets and provider latency.

## Ollama

Ollama support is local-first:

```bash
TOKENOPS_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
pnpm --filter @nerve/server start
```

Requests with model `local` are mapped to `OLLAMA_MODEL`.

Availability-aware throughput check:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput ollama \
  --requests 8 \
  --concurrency 2 \
  --model llama3.2
```

The command probes `/api/tags` first. If Ollama is unavailable, it returns `skipped: true` with an actionable reason instead of failing the run.
