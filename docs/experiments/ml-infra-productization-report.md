# TokenOps ML Infra Productization Report

Generated: 2026-05-30

## What Changed

This pass moved TokenOps from a narrow cache/router MVP toward a local-first adaptive inference control plane with practical ML infrastructure behavior:

- real OpenAI-compatible provider adapter
- real Ollama local inference adapter
- provider fallback chains
- provider retry and timeout wrapper
- trace-derived adaptive routing endpoint
- optional adaptive routing in the gateway runtime
- verifier eval harness with confusion metrics
- stronger replay benchmark metrics
- live Groq direct-vs-gateway report generation
- CLI commands for live comparison, verifier eval, replay, and routing policy
- SQLite-backed semantic, tool-result, and context-block cache stores
- gateway semantic/context cache persistence across app restarts
- verifier pass-rate gated adaptive routing
- provider health scoring from local traces
- OpenAI live direct-vs-gateway comparison command with skipped-report behavior when no key is configured
- verifier eval JSONL dataset loading
- Ollama availability-aware gateway smoke command with skipped-report behavior

## Product Commands

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts routing policy
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts providers health
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts verify eval --dataset benchmark/verifier/basic.jsonl
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare groq
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare openai
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts smoke ollama
```

## Runtime Controls

```bash
TOKENOPS_PROVIDER=groq,ollama,mock
TOKENOPS_PROVIDER_RETRIES=1
TOKENOPS_PROVIDER_TIMEOUT_MS=30000
TOKENOPS_ADAPTIVE_ROUTING=1
TOKENOPS_ROUTING_MIN_SAMPLES=2
```

## Evidence

Verification run on 2026-05-30:

- `pnpm typecheck`: passed
- `pnpm test`: 17 files, 64 tests passed
- `tokenops replay --all`: passed
- `tokenops verify eval`: passed, accuracy `1.0` on built-in cases
- `tokenops compare groq`: passed with live Groq
- `tokenops compare openai`: passed in skipped-report mode because `OPENAI_API_KEY` was not configured
- `tokenops providers health`: passed
- `tokenops verify eval --dataset benchmark/verifier/basic.jsonl`: passed
- `tokenops smoke ollama`: passed in skipped-report mode because local Ollama was not reachable
- `scripts/prove-tokenops.ts`: passed with live Groq exact-cache proof
- `scripts/prove-tokenops-controls.ts`: passed
- `scripts/prove-tokenops-implemented-claims.ts`: passed
- persistent cache tests: passed through `apps/server/server.test.ts` and `packages/cache/cache.test.ts`

Live Groq comparison showed:

- Direct Groq provider calls: 2
- TokenOps provider calls observed: 1
- TokenOps exact hits: `false, true`
- Content matched: `true`

## Still Prototype

- Adaptive routing is trace-derived rules, not online bandit/RL optimization.
- Semantic cache is lexical, not embedding-backed.
- Verifier eval is small and deterministic; production quality needs adversarial and workload-specific datasets.
- Billing reconciliation uses local pricing and provider usage tokens, not provider invoice ingestion.
- Tool-result cache persistence exists as a package primitive, but the chat gateway does not execute tool calls itself yet.
- Anthropic, Gemini, and vLLM remain scaffolded.

## Next Practical Steps

1. Add embedding-backed semantic cache with safe-workload gates.
2. Run real OpenAI live comparison when `OPENAI_API_KEY` is configured.
3. Add explicit provider error and timeout traces to provider health scoring.
4. Add adaptive routing health gates to reject learned routes with poor provider health in runtime integration tests.
5. Expand verifier eval datasets with adversarial prompt injection and stale-cache cases.
6. Add real Ollama smoke proof when local Ollama and a model are installed.
7. Add explicit tool execution hooks so gateway traces can populate `SqliteToolResultCache` during real tool workflows.
