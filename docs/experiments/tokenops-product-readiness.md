# TokenOps Product Readiness Proof

Generated: 2026-05-30T19:26:56.181Z

## Summary

- Ready for local demo: true
- Replay datasets: 6
- Replay requests: 16
- Baseline cost: $0.127855
- Optimized cost: $0.005666
- Estimated replay cost reduction: 95.6%
- Runtime avoided provider calls: 15
- Micro-batching latency reduction: 0.9%
- Priority scheduling: foreground -> background-1 -> background-2
- Load shedding: shed=1, foreground_admitted=true
- Background tasks: completed=3, failed=0
- Provider failover: circuit=true, fallback calls=8, failed=0
- Mock output tokens/sec: 32000
- Groq live measured: true
- Adaptive routing route: gpt-5.5 -> gpt-5-mini
- Adaptive routing avoided cost/request: $0.0098
- Provider SLO routing: groq -> mock, p95=18000ms
- Provider fallback route: groq -> mock
- Provider arbitrage route: openai -> groq, avg_cost=$0.01, health=0.84
- Verifier gate escalation: cheap pass, strong after fail
- Verifier routing eval: 3/3 expected escalations, missed=0
- Policy controls: budget block, loop block
- Cache safety: docs semantic_safe, risky never_cache
- Semantic safety eval: 13 cases, unsafe hits=0, safe misses=0
- Semantic threshold sweep: recommended=0.2, thresholds=5
- Cheaper analyzer: 3 insights, $0.0244 avoidable
- Gateway compatibility: chat.completion + response + embeddings(4d), usage=true, tokenops=true
- Trace ledger: 2 traces, savings=$0.018
- Provider usage reconciliation: records=1, drift=1, delta=$0.000972
- AIS planner: exact=serve_exact_cache, semantic=serve_semantic_cache, budget=block_budget

## Gates

- replayShowsSavings: true
- exactOrSemanticCacheObserved: true
- toolOrContextReuseObserved: true
- runtimeCoalescingAvoidsCalls: true
- microBatchingReducesLatency: true
- prioritySchedulingProtectsForegroundInference: true
- loadSheddingProtectsForegroundInference: true
- backgroundTaskQueueExecutesAisTasks: true
- runtimeCircuitBreakerFallsBackAfterPrimaryFailures: true
- mockThroughputMeasured: true
- adaptiveRoutingDowngradesFromTraceEvidence: true
- providerSloRoutingAvoidsUnhealthyProviders: true
- providerFallbackSurvivesPrimaryFailure: true
- providerArbitrageChoosesCheapestHealthyProvider: true
- verifierGateEscalatesFailedCheapAnswer: true
- verifierRoutingEvalPasses: true
- policyControlsBlockWastefulCompute: true
- semanticCacheSafetyBlocksRiskyPrivateWorkloads: true
- semanticCacheAdversarialEvalPasses: true
- semanticThresholdSweepFindsSafeThreshold: true
- cheaperAnalyzerFindsAvoidableCompute: true
- openAICompatibleGatewayShape: true
- traceLedgerRecordsCostAndCacheEvidence: true
- providerUsageReconciliationDetectsBillingDrift: true
- aisPlannerChoosesForegroundAndBackgroundActions: true
- groqThroughputAvailableWhenRequested: true

## Gaps

- Distributed scheduler state, queueing, and circuit breaker coordination are not implemented.
- Semantic cache correctness is heuristic; threshold sweep exists, but the adversarial corpus still needs production-scale expansion.
- Provider usage reconciliation supports JSONL ingestion; direct provider invoice API ingestion is not implemented.
- Hosted multi-tenant auth, deployment, dashboards, and enterprise controls are intentionally out of scope for this local prototype.
