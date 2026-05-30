# TokenOps Architecture

TokenOps is an adaptive inference control plane for AI apps and agents. It sits before model execution and decides whether to cache, route, downgrade, escalate, verify, block, or trace a request.

Flow:

```text
App / Agent / Coding Tool
  -> OpenAI-compatible Gateway
  -> Request Normalizer
  -> Workload Profiler
  -> Policy + Budget Firewall
  -> Cache / Reuse Layer
  -> AIS Compute Planner
  -> Model / Provider Router
  -> Verifier / Eval Gate
  -> Trace + Cost Ledger
  -> Replay Benchmark
```

Current implementation keeps the existing `nerve` compile/learn/replay loop and adds TokenOps serving-path packages under `@tokenops/*`.

Production-like today: OpenAI-compatible non-streaming `/v1/chat/completions`, deterministic request normalization, exact cache, semantic cache safety guard, model routing, budget decision, AIS plan, trace ledger, benchmark runner, mock provider, and a local inference runtime with admission control, bounded queueing, circuit breaker, timeout aborts, and in-flight coalescing.

Prototype today: semantic/tool/context caches remain in-process, classifiers are heuristic, verifier is heuristic, pricing is simulated/configurable, and non-mock providers are adapter-ready stubs.
