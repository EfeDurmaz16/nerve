import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { MockProvider } from "@tokenops/providers";
import { cheapThenVerify, evaluateVerifierCases, parseJudgment, semanticCacheDecisionFromVerifier, verifyResponse, verifyResponseWithModel } from "./src/index.js";
import type { ModelProvider } from "@tokenops/providers";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

describe("TokenOps verifier gate", () => {
  it("fails response with failure marker", () => {
    const req = normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "x" }] });
    expect(verifyResponse(req, { id: "x", model: "mock", provider: "mock", content: "ERROR: bad", finish_reason: "stop", input_tokens: 1, output_tokens: 1, latency_ms: 1, cost_usd: 0 }).status).toBe("failed");
  });

  it("runs cheap then verify", async () => {
    const req = normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "x" }] });
    const out = await cheapThenVerify({ request: req, cheapProvider: new MockProvider(), strongProvider: new MockProvider() });
    expect(out.response.content).toContain("Mock TokenOps");
  });

  it("parses model verifier decisions and semantic cache serving choice", () => {
    const pass = parseJudgment("PASS: grounded answer", "test");
    const fail = parseJudgment("FAIL: unsupported answer", "test");
    expect(semanticCacheDecisionFromVerifier(pass).serve).toBe(true);
    expect(semanticCacheDecisionFromVerifier(fail).serve).toBe(false);
  });

  it("uses a model provider as verifier", async () => {
    const req = normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "answer yes" }] });
    const decision = await verifyResponseWithModel({
      provider: new JudgeProvider("PASS: answer matches"),
      request: req,
      response: { id: "r", model: "mock", provider: "mock", content: "yes", finish_reason: "stop", input_tokens: 1, output_tokens: 1, latency_ms: 1, cost_usd: 0 },
    });
    expect(decision.status).toBe("passed");
    expect(decision.verifierProvider).toBe("judge");
  });

  it("scores verifier cases with confusion metrics", async () => {
    const result = await evaluateVerifierCases({
      provider: new SequenceJudgeProvider(["PASS: ok", "FAIL: bad", "UNCERTAIN: ambiguous"]),
      cases: [
        { id: "pass", request: [{ role: "user", content: "answer from docs" }], response: "docs answer", expected: "passed" },
        { id: "fail", request: [{ role: "user", content: "answer from docs" }], response: "invented answer", expected: "failed" },
        { id: "uncertain", request: [{ role: "user", content: "ambiguous" }], response: "maybe", expected: "uncertain" },
      ],
    });
    expect(result.total).toBe(3);
    expect(result.accuracy).toBe(1);
    expect(result.falsePasses).toBe(0);
    expect(result.cases[1]!.actual).toBe("failed");
  });
});

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

class SequenceJudgeProvider implements ModelProvider {
  readonly name = "sequence-judge";
  private index = 0;
  constructor(private readonly judgments: string[]) {}
  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    const content = this.judgments[this.index++] ?? "UNCERTAIN";
    return {
      id: `judge_${this.index}`,
      model: request.requested_model,
      provider: this.name,
      content,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}
