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
