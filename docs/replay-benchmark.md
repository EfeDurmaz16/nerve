# Replay Benchmark

TokenOps replay compares:

1. baseline direct mock provider calls
2. optimized gateway execution

Datasets live in `benchmark/datasets/`:

- `docs-qa.jsonl`
- `support-faq.jsonl`
- `coding-agent.jsonl`
- `long-prefix.jsonl`
- `agent-loop.jsonl`
- `tool-result-reuse.jsonl`

Run:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay benchmark/datasets/docs-qa.jsonl --persist
```

Persisted replay results can be exported with local gateway traces:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts export ./tokenops-snapshot.json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts import ./tokenops-snapshot.json
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts prune --keep-traces 1000 --keep-benchmarks 100 --keep-idempotency 1000
```

Reported metrics include:

- total requests
- baseline and optimized model calls
- baseline and optimized estimated cost
- estimated savings
- exact, semantic, tool-result, and context-block reuse rates
- model downgrade rate
- verifier escalation rate
- estimated input and output tokens saved
- provider prefix-cache eligible tokens
- p50/p95 latency estimate
- wrong-cache incidents
- quality warnings

The benchmark is still a local replay harness. It estimates provider economics and latency rather than replacing production billing or a full human quality eval.
