import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeOpenAIChatRequest } from "@tokenops/gateway";
import type { ModelProvider } from "@tokenops/providers";
import type { ChatMessage, ModelResponse, NormalizedRequest, RiskLevel } from "@tokenops/core";
import { cheapThenVerify } from "@tokenops/verifier";

export interface CheapThenVerifyCase {
  id: string;
  model?: string;
  messages: ChatMessage[];
  riskLevel?: RiskLevel;
  cheapResponse: string;
  strongResponse: string;
  expectedEscalated: boolean;
}

export interface CheapThenVerifyCaseResult {
  id: string;
  expectedEscalated: boolean;
  actualEscalated: boolean;
  verifierPassed: boolean;
  finalProvider: string;
  passed: boolean;
}

export interface CheapThenVerifyBenchmarkResult {
  dataset: string;
  totalCases: number;
  expectedEscalations: number;
  actualEscalations: number;
  falseEscalations: number;
  missedEscalations: number;
  cheapProviderCalls: number;
  strongProviderCalls: number;
  cases: CheapThenVerifyCaseResult[];
  passed: boolean;
}

export async function runCheapThenVerifyBenchmark(datasetPath: string): Promise<CheapThenVerifyBenchmarkResult> {
  const cases = readJsonl(datasetPath);
  const results: CheapThenVerifyCaseResult[] = [];
  let cheapProviderCalls = 0;
  let strongProviderCalls = 0;

  for (const testCase of cases) {
    const baseRequest = normalizeOpenAIChatRequest({
      model: testCase.model ?? "gpt-5-mini",
      messages: testCase.messages,
    });
    const request: NormalizedRequest = {
      ...baseRequest,
      workload_type: "verification",
      risk_level: testCase.riskLevel ?? "low",
    };
    const cheap = new ScriptedProvider("cheap", testCase.cheapResponse, () => {
      cheapProviderCalls += 1;
    });
    const strong = new ScriptedProvider("strong", testCase.strongResponse, () => {
      strongProviderCalls += 1;
    });
    const outcome = await cheapThenVerify({ request, cheapProvider: cheap, strongProvider: strong });
    const actualEscalated = outcome.escalatedAfterFail;
    results.push({
      id: testCase.id,
      expectedEscalated: testCase.expectedEscalated,
      actualEscalated,
      verifierPassed: outcome.verifierPassed,
      finalProvider: outcome.response.provider,
      passed: actualEscalated === testCase.expectedEscalated,
    });
  }

  const expectedEscalations = cases.filter((testCase) => testCase.expectedEscalated).length;
  const actualEscalations = results.filter((result) => result.actualEscalated).length;
  const falseEscalations = results.filter((result) => result.actualEscalated && !result.expectedEscalated).length;
  const missedEscalations = results.filter((result) => !result.actualEscalated && result.expectedEscalated).length;
  return {
    dataset: datasetPath,
    totalCases: results.length,
    expectedEscalations,
    actualEscalations,
    falseEscalations,
    missedEscalations,
    cheapProviderCalls,
    strongProviderCalls,
    cases: results,
    passed: results.length > 0 && falseEscalations === 0 && missedEscalations === 0 && results.every((result) => result.passed),
  };
}

class ScriptedProvider implements ModelProvider {
  constructor(readonly name: string, private readonly content: string, private readonly onCall: () => void) {}

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    this.onCall();
    return {
      id: `${this.name}_${request.id}`,
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

function readJsonl(path: string): CheapThenVerifyCase[] {
  return readFileSync(resolve(path), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CheapThenVerifyCase);
}
