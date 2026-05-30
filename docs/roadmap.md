# TokenOps Roadmap

This roadmap separates what the current workspace can reach now from what should become a production system over one year.

## Reached Now

- OpenAI-compatible `/v1/chat/completions`
- non-streaming and basic SSE streaming responses
- OpenAI-compatible `/v1/responses`
- deterministic local `/v1/embeddings` for compatibility and cache/profiler experiments
- mock provider
- exact cache with user/agent isolation
- semantic cache guarded by cacheability classifier
- prefix cache simulator
- tool-result and context-block cache primitives
- workload profiler
- model router
- budget firewall
- AIS foreground/background compute plan
- request trace and cost ledger
- SQLite-backed TokenOps request traces
- SQLite-backed TokenOps exact cache entries
- SQLite-backed idempotency records for retry-safe gateway calls
- SQLite-backed benchmark results
- snapshot import/export for TokenOps traces and benchmark results
- retention pruning for local and imported evidence
- `/replay` API for local dataset benchmark runs
- `/benchmark/results`
- could-have-been-cheaper analyzer endpoint
- replay datasets and deterministic CLI demo
- tests and typecheck

## 1-Month Target

The 1-month target is a credible local/self-hosted alpha that can sit in front of real agent workloads without silently leaking data or producing fake savings.

### Persistence

- Move all TokenOps cache layers into SQLite-backed stores.
- Add migrations for semantic cache, tool-result cache, context-block fingerprints, daily budget usage, and provider call attempts.
- Add time-window and size-aware retention policies beyond count-based pruning.

### Provider Adapters

- Implement real OpenAI adapter behind an explicit feature flag.
- Add Anthropic and Gemini adapters with the same `ModelProvider` interface.
- Add Ollama adapter for local development.
- Add vLLM adapter for self-hosted inference.
- Ensure adapter errors never echo API keys, auth headers, or raw sensitive prompts.

### Safety

- Replace basic redaction with configurable redaction hooks.
- Add redaction tests for API keys, bearer tokens, emails, payment data, credentials, and private repo paths.
- Add semantic-cache poisoning tests.
- Add stale tool-result tests.
- Add explicit local-mode auth warning on startup.

### Serving

- Support OpenAI-style streaming with token-level chunks when real providers support it.
- Harden `/v1/responses` beyond minimal non-streaming compatibility.
- Add provider-backed embeddings for production semantic-cache experiments.
- Extend idempotency replay to streaming responses once token-level stream capture exists.
- Add request timeout and retry policy.

### Replay and Evaluation

- Persist every replay run.
- Add quality warnings and wrong-cache incident simulation to all benchmark reports.
- Add larger datasets for coding agents, support, docs, long-prefix, and tool reuse.
- Add a replay mode over stored traces.

### CLI

- Make `tokenops` first-class in package scripts.
- Add JSON output mode for all reporting commands.
- Add `tokenops inspect trace`, `tokenops inspect cache`, and `tokenops doctor`.

## 1-Year Target

The 1-year target is a production adaptive inference control plane for serious agent runtimes.

### Control Plane

- Multi-tenant org/project/user model.
- Policy bundles with versioning, approvals, simulation, and rollback.
- Budget policies by user, agent, team, project, workflow, tool, provider, and customer.
- Per-task and per-loop spend envelopes.
- Kill switches and emergency deny policies.
- Policy simulation before rollout.

### Caching and Reuse

- Embedding-backed semantic cache with eval-gated promotion.
- Provider prefix-cache optimization per provider/model.
- Context-block CDN semantics for repo snapshots, docs bundles, tool schemas, and policy text.
- Tool-result cache with resource-version adapters for Git, DB snapshots, docs indexes, web search windows, and file hashes.
- Cache provenance, confidence, expiry, poisoning detection, and invalidation graph.

### Routing and Quality

- Learned routing policy from trace outcomes, verifier pass rates, and cost.
- Cheap-then-verify with model-graded and tool-verified gates.
- Automatic escalation when cheap paths fail.
- Provider failover and regional routing.
- Latency-aware routing and batching.
- Quality budgets, not just cost budgets.

### Evidence and Trust

- FIDES-style signed evidence chains for request decisions.
- Tamper-evident trace ledger.
- Signed receipts for cache hits, policy decisions, provider calls, verifier runs, and budget blocks.
- OAPS-compatible schemas for requests, policies, traces, evidence, and replay results.
- Export to OpenTelemetry, Langfuse, LangSmith, Braintrust, and warehouse sinks.

### Agent Runtime Integration

- Drop-in adapters for OpenAI SDK, Vercel AI SDK, LangChain/LangGraph, Mastra, CrewAI, and OpenAI Agents SDK.
- MCP server for cache stats, budget status, trace lookup, replay, and policy simulation.
- Coding-agent integration for repo-context and tool-result reuse.
- AGIT integration for content-addressed repo state and replayable agent work.

### Product Surface

- Local-first CLI remains primary.
- Minimal operator dashboard for traces, cache, budget, and replay reports.
- Policy review queue for risky route/cache promotions.
- Design partner workflow: import traces, replay opportunities, approve policies, measure savings and quality deltas.

### Production Readiness

- Durable queue for background verification and cache refresh.
- Optional Redis/Qdrant/Postgres backends.
- Horizontal gateway deployment.
- Provider-key vaulting.
- SOC2-friendly audit logs.
- Tenant isolation tests.
- Load tests and benchmark harness.
- Security review for cache poisoning, cross-user leakage, prompt injection, and provider-key handling.

## Strategic Linkage

- Sardis: policy before economic spend.
- TokenOps: policy before compute spend.
- FIDES: signed authority, trust, and evidence chain for TokenOps decisions.
- OAPS: standard schemas for agent compute policies, traces, and evidence.
- OSP: service/provider manifests, cost summaries, and lifecycle controls.
- AGIT: content-addressed agent work and repo context reuse.
- AIS: the compute planner inside TokenOps.
