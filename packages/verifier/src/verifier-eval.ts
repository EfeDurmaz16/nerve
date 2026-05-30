import { normalizeChatCompletionRequest, type ChatMessage, type ModelResponse, type NormalizedRequest } from "@tokenops/core";
import type { ModelProvider } from "@tokenops/providers";
import { verifyResponseWithModel, type ModelVerifierDecision } from "./model-verifier.js";

export interface VerifierEvalCase {
  id: string;
  request: ChatMessage[];
  response: string;
  expected: ModelVerifierDecision["status"];
  model?: string;
  riskLevel?: NormalizedRequest["risk_level"];
}

export interface VerifierEvalCaseResult {
  id: string;
  expected: ModelVerifierDecision["status"];
  actual: ModelVerifierDecision["status"];
  passed: boolean;
  reason: string;
}

export interface VerifierEvalResult {
  total: number;
  accuracy: number;
  falsePasses: number;
  falseFails: number;
  uncertainRate: number;
  cases: VerifierEvalCaseResult[];
}

export async function evaluateVerifierCases(input: {
  provider: ModelProvider;
  cases: VerifierEvalCase[];
}): Promise<VerifierEvalResult> {
  const results: VerifierEvalCaseResult[] = [];
  for (const testCase of input.cases) {
    const request = normalizeChatCompletionRequest({
      model: testCase.model ?? "gpt-5-mini",
      messages: testCase.request,
    });
    const normalized: NormalizedRequest = {
      ...request,
      workload_type: "verification",
      risk_level: testCase.riskLevel ?? "low",
    };
    const response: ModelResponse = {
      id: `eval_response_${testCase.id}`,
      model: normalized.requested_model,
      provider: "eval-fixture",
      content: testCase.response,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
    const decision = await verifyResponseWithModel({ provider: input.provider, request: normalized, response });
    results.push({
      id: testCase.id,
      expected: testCase.expected,
      actual: decision.status,
      passed: decision.status === testCase.expected,
      reason: decision.reason,
    });
  }

  const correct = results.filter((r) => r.passed).length;
  const falsePasses = results.filter((r) => r.actual === "passed" && r.expected !== "passed").length;
  const falseFails = results.filter((r) => r.actual === "failed" && r.expected === "passed").length;
  const uncertain = results.filter((r) => r.actual === "uncertain").length;
  return {
    total: results.length,
    accuracy: rate(correct, results.length),
    falsePasses,
    falseFails,
    uncertainRate: rate(uncertain, results.length),
    cases: results,
  };
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 10_000) / 10_000;
}
