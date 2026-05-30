# AIS Compute Planner

AIS is the compute planning brain inside TokenOps.

For every gateway request, AIS emits a compute plan with:

- foreground action: exact cache, semantic cache, model call, budget block, partial return, or clarification
- background tasks: cached-answer verification, context precompute, trace compression, tool-cache refresh, fallback preparation, quality evaluation
- model route
- cache strategy
- context strategy
- expected latency/cost/risk
- reason

The current implementation is heuristic and deterministic. It is designed to become policy/data-driven later.

## Local Background Execution

AIS background tasks are now paired with a local in-process `BackgroundTaskQueue`
in `@tokenops/runtime`. The queue is intentionally not a durable distributed
worker system, but it gives the local control plane real execution semantics:

- bounded background concurrency
- bounded queue length
- priority ordering for urgent verification before low-priority maintenance
- per-task completion/failure stats

The product-readiness proof schedules `verify_cached_answer`, `compress_trace`,
and `evaluate_quality` work through this queue and fails if the queue cannot
complete AIS background work without errors.
