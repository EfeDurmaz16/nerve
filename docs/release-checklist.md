# TokenOps Release Checklist

Use this before tagging, pushing, or demoing TokenOps.

## Local Verification

```bash
pnpm typecheck
pnpm test
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts replay --all
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof
```

If `GROQ_API_KEY` is configured in `.env`, also run:

```bash
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts compare groq
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq --requests 4 --concurrency 2
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts proof --include-groq
```

If Ollama is installed locally, also run:

```bash
ollama serve
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts smoke ollama
TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput ollama --requests 8 --concurrency 2
```

## Secret Safety

- Keep `.env` and `.env.local` ignored.
- Do not commit provider API keys.
- Prefer `.env.example` for documented config.
- Check generated reports before publishing if they came from live providers.

## Demo Acceptance

A local demo is acceptable when:

- `tokenops proof` reports `readyForLocalDemo: true`.
- Replay benchmark shows cost reduction across all bundled datasets.
- Runtime coalescing avoids at least one provider call.
- Micro-batching shows positive latency reduction.
- Provider throughput reports tokens/sec for mock and any configured live provider.
- Known gaps are documented instead of hidden.

## Current Non-Goals

- Hosted dashboard.
- Multi-tenant auth.
- Distributed queue/circuit state.
- Provider invoice reconciliation.
- Production-grade semantic-cache correctness guarantees.
