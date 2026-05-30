import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelProvider } from "@tokenops/providers";
import type { ModelResponse, NormalizedRequest, RequestTrace } from "@tokenops/core";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { reconcileModelResponseCost } from "@tokenops/ledger";
import { applyLearnedRouting, learnRoutingPolicy } from "@tokenops/router";
import { semanticCacheDecisionFromVerifier, verifyResponseWithModel } from "@tokenops/verifier";

const REPORT_PATH = "docs/experiments/tokenops-implemented-claims-report.json";

async function main() {
  const traces = [
    trace("tr_1", 0.0001, "gpt-5-mini"),
    trace("tr_2", 0.0002, "gpt-5-mini"),
    trace("tr_3", 0.01, "gpt-5.5"),
  ];
  const learnedPolicy = learnRoutingPolicy(traces, { minSamples: 2 });
  const learnedRoute = applyLearnedRouting(
    {
      selectedProvider: "groq",
      selectedModel: "gpt-5.5",
      originalRequestedModel: "gpt-5.5",
      downgraded: false,
      escalated: false,
      reason: "base route",
    },
    { workloadType: "docs_qa", riskLevel: "low" },
    learnedPolicy,
  );

  const request = normalizeChatCompletionRequest({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "Answer from docs only." }],
  });
  const candidate: ModelResponse = {
    id: "candidate",
    model: request.requested_model,
    provider: "groq",
    content: "The docs say TokenOps caches repeated calls.",
    finish_reason: "stop",
    input_tokens: 42,
    output_tokens: 12,
    latency_ms: 1,
    cost_usd: 0.000034,
  };
  const modelVerifierPass = await verifyResponseWithModel({
    provider: new JudgeProvider("PASS: grounded in supplied docs"),
    request,
    response: candidate,
  });
  const semanticDecisionPass = semanticCacheDecisionFromVerifier(modelVerifierPass);
  const modelVerifierFail = await verifyResponseWithModel({
    provider: new JudgeProvider("FAIL: answer is not grounded"),
    request,
    response: candidate,
  });
  const semanticDecisionFail = semanticCacheDecisionFromVerifier(modelVerifierFail);

  const reconciliation = reconcileModelResponseCost({
    ...candidate,
    input_tokens: 42,
    output_tokens: 4,
    cost_usd: 0.000028,
  });

  const report = {
    implementedClaims: {
      learnedRouting: {
        policy: learnedPolicy,
        appliedRoute: learnedRoute,
      },
      modelBackedVerifier: {
        pass: modelVerifierPass,
        fail: modelVerifierFail,
      },
      semanticVerificationDecision: {
        passDecision: semanticDecisionPass,
        failDecision: semanticDecisionFail,
      },
      usageReconciliation: reconciliation,
    },
    assertions: {
      learnedRoutingChoosesMini: learnedRoute.selectedModel === "gpt-5-mini" && learnedRoute.reason.includes("learned routing policy"),
      modelVerifierPassesGroundedAnswer: modelVerifierPass.status === "passed" && modelVerifierPass.verifierProvider === "judge",
      modelVerifierFailsUngroundedAnswer: modelVerifierFail.status === "failed",
      semanticPassServesCache: semanticDecisionPass.serve === true,
      semanticFailDoesNotServeCache: semanticDecisionFail.serve === false,
      costReconciliationMatches: reconciliation.status === "matched",
    },
    limits: {
      learnedRouting: "Implemented as trace-derived policy rules, not a bandit/RL optimizer.",
      verifier: "Implemented as model-backed verifier interface. Production quality depends on verifier prompt, model, evals, and adversarial testing.",
      semanticCorrectness: "Implemented serving decision based on verifier output, not broad empirical semantic-cache benchmark yet.",
      billing: "Implemented local pricing reconciliation against usage tokens, not provider invoice ingestion.",
    },
  };

  const allPassed = Object.values(report.assertions).every(Boolean);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ allPassed, reportPath: REPORT_PATH, report }, null, 2));
  if (!allPassed) process.exit(1);
}

class JudgeProvider implements ModelProvider {
  readonly name = "judge";
  constructor(private readonly judgment: string) {}
  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    return {
      id: "judge_response",
      model: request.requested_model,
      provider: this.name,
      content: this.judgment,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}

function trace(id: string, optimizedCost: number, selectedModel: string): RequestTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    workloadType: "docs_qa",
    requestedModel: "gpt-5.5",
    selectedModel,
    selectedProvider: "groq",
    inputTokensEstimated: 100,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: "groq", selectedModel, originalRequestedModel: "gpt-5.5", downgraded: selectedModel !== "gpt-5.5", escalated: false, reason: "historical route" },
    policy: { allowed: true, reason: "budget policy allowed request" },
    cost: { estimatedBaselineCost: 0.01, estimatedOptimizedCost: optimizedCost, estimatedSavings: Math.max(0, 0.01 - optimizedCost) },
    quality: { verifierUsed: false, verifierPassed: true },
    normalizedHash: id,
    finalResponseSource: "model",
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
