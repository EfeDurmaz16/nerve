import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "@nerve/store";
import { createApp } from "../apps/server/src/index.js";
import { normalizeChatCompletionRequest, type ModelResponse, type NormalizedRequest, type RequestTrace } from "@tokenops/core";
import { classifyCacheability, classifyWorkload } from "@tokenops/profiler";
import { detectAgentLoop } from "@tokenops/policy";
import { cheapThenVerify } from "@tokenops/verifier";
import type { ModelProvider } from "@tokenops/providers";

const REPORT_PATH = "docs/experiments/tokenops-controls-proof-report.json";

type ChatResponse = {
  model: string;
  choices: Array<{ message: { content: string } }>;
  tokenops?: {
    provider: string;
    cache: { exactHit: boolean; semanticHit: boolean };
    routing: { selectedModel: string; downgraded: boolean; escalated: boolean; reason: string };
    policy: { allowed: boolean; reason: string };
  };
};

async function main() {
  const oldProvider = process.env.TOKENOPS_PROVIDER;
  process.env.TOKENOPS_PROVIDER = "mock";

  const semanticApp = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
  const semanticFirst = await chat(semanticApp, {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "documentation quickstart cache setup install guide" }],
  });
  const semanticSecond = await chat(semanticApp, {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "documentation quickstart cache setup install guide please" }],
  });
  await semanticApp.close();

  const routingApp = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
  const routed = await chat(routingApp, {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "What does the documentation quickstart say about cache setup?" }],
  });
  await routingApp.close();

  const risky = normalizeChatCompletionRequest({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "Use this private secret token to wire a payment from my account." }],
  });
  const riskyProfile = classifyWorkload(risky);
  const riskyCacheability = classifyCacheability({ ...risky, risk_level: riskyProfile.riskLevel, workload_type: riskyProfile.workloadType });

  const verifierPassed = await cheapThenVerify({
    request: normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "normal answer" }] }),
    cheapProvider: new StaticProvider("cheap", "safe answer"),
    strongProvider: new StaticProvider("strong", "strong answer"),
  });
  const verifierEscalated = await cheapThenVerify({
    request: normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "needs escalation" }] }),
    cheapProvider: new StaticProvider("cheap", "ERROR: bad answer"),
    strongProvider: new StaticProvider("strong", "strong answer"),
  });

  const loopTraces = Array.from({ length: 6 }, (_, i) => trace(`tr_${i}`, "same-hash"));
  const loopSignal = detectAgentLoop(loopTraces, "agent_1");

  if (oldProvider === undefined) delete process.env.TOKENOPS_PROVIDER;
  else process.env.TOKENOPS_PROVIDER = oldProvider;

  const report = {
    hypotheses: {
      semanticCache: "Safe docs-style paraphrase should use semantic cache instead of a second model call.",
      routing: "Safe docs-style request for an expensive model should downgrade to cheaper model.",
      safety: "Private/payment/secret requests should not be semantic-cache eligible.",
      verifier: "Cheap-then-verify should return cheap output on pass and escalate on fail.",
      loopLimiter: "Repeated identical agent prompts should produce a block signal.",
    },
    observed: {
      semanticCache: {
        first: summarize(semanticFirst),
        second: summarize(semanticSecond),
      },
      routing: summarize(routed),
      safety: {
        workloadType: riskyProfile.workloadType,
        riskLevel: riskyProfile.riskLevel,
        cacheability: riskyCacheability,
      },
      verifier: {
        passCase: {
          content: verifierPassed.response.content,
          verifierPassed: verifierPassed.verifierPassed,
          escalatedAfterFail: verifierPassed.escalatedAfterFail,
        },
        failCase: {
          content: verifierEscalated.response.content,
          verifierPassed: verifierEscalated.verifierPassed,
          escalatedAfterFail: verifierEscalated.escalatedAfterFail,
        },
      },
      loopLimiter: loopSignal,
    },
    assertions: {
      semanticSecondHit: semanticSecond.tokenops?.cache.semanticHit === true,
      semanticDidNotUseExactCache: semanticSecond.tokenops?.cache.exactHit === false,
      docsRequestDowngraded: routed.tokenops?.routing.downgraded === true && routed.tokenops.routing.selectedModel === "gpt-5-mini",
      riskyPromptNeverCache: riskyCacheability === "never_cache",
      verifierPassDoesNotEscalate: verifierPassed.verifierPassed === true && verifierPassed.escalatedAfterFail === false,
      verifierFailEscalates: verifierEscalated.verifierPassed === false && verifierEscalated.escalatedAfterFail === true && verifierEscalated.response.content === "strong answer",
      loopLimiterBlocks: loopSignal.action === "block",
    },
    additionalProofs: {
      learnedRouting: "Covered by scripts/prove-tokenops-implemented-claims.ts as a trace-derived policy, not a bandit/RL optimizer.",
      modelBackedVerifier: "Covered by scripts/prove-tokenops-implemented-claims.ts with a provider-backed judge interface.",
      usageReconciliation: "Covered by scripts/prove-tokenops-implemented-claims.ts against usage tokens and local pricing.",
    },
    notProvenHere: {
      productionVerifierQuality: "This proves verifier control flow, not answer-quality lift across adversarial evals.",
      realSemanticCorrectness: "This proves lexical semantic-cache behavior on a controlled safe paraphrase, not broad semantic correctness.",
      providerInvoiceReconciliation: "Local usage reconciliation exists, but provider invoice ingestion is not implemented.",
    },
  };

  const allPassed = Object.values(report.assertions).every(Boolean);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ allPassed, reportPath: REPORT_PATH, report }, null, 2));
  if (!allPassed) process.exit(1);
}

type InjectableApp = {
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{
    statusCode: number;
    body: string;
    json(): unknown;
  }>;
};

async function chat(app: InjectableApp, payload: unknown): Promise<ChatResponse> {
  const res = await app.inject({ method: "POST", url: "/v1/chat/completions", payload });
  if (res.statusCode !== 200) throw new Error(`chat failed ${res.statusCode}: ${res.body}`);
  return res.json() as ChatResponse;
}

function summarize(response: ChatResponse) {
  return {
    model: response.model,
    content: response.choices[0]?.message.content,
    provider: response.tokenops?.provider,
    exactHit: response.tokenops?.cache.exactHit,
    semanticHit: response.tokenops?.cache.semanticHit,
    selectedModel: response.tokenops?.routing.selectedModel,
    downgraded: response.tokenops?.routing.downgraded,
    escalated: response.tokenops?.routing.escalated,
    policyAllowed: response.tokenops?.policy.allowed,
  };
}

class StaticProvider implements ModelProvider {
  constructor(readonly name: string, private readonly content: string) {}
  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    return {
      id: `${this.name}_response`,
      model: request.requested_model,
      provider: this.name,
      content: this.content,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}

function trace(id: string, hash: string): RequestTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    workloadType: "agent_planning",
    agentId: "agent_1",
    requestedModel: "mock",
    selectedModel: "mock",
    selectedProvider: "mock",
    inputTokensEstimated: 1,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: "mock", selectedModel: "mock", downgraded: false, escalated: false, reason: "test" },
    policy: { allowed: true, reason: "test" },
    cost: { estimatedBaselineCost: 0, estimatedOptimizedCost: 0, estimatedSavings: 0 },
    normalizedHash: hash,
    finalResponseSource: "model",
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
