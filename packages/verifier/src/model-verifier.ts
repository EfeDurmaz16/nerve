import type { ModelProvider } from "@tokenops/providers";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";
import { verifyResponse, type ServingVerifierResult } from "./verifier.js";

export interface ModelVerifierDecision extends ServingVerifierResult {
  rawJudgment: string;
  verifierProvider: string;
}

export async function verifyResponseWithModel(input: {
  provider: ModelProvider;
  request: NormalizedRequest;
  response: ModelResponse;
}): Promise<ModelVerifierDecision> {
  const heuristic = verifyResponse(input.request, input.response);
  if (heuristic.status === "failed") {
    return { ...heuristic, rawJudgment: heuristic.reason, verifierProvider: "heuristic" };
  }

  const judgmentRequest: NormalizedRequest = {
    ...input.request,
    requested_model: input.request.requested_model,
    messages: [
      {
        role: "system",
        content:
          "You are a strict verifier. Reply with exactly PASS, FAIL, or UNCERTAIN followed by a short reason. Judge whether the answer addresses the user request without unsafe assumptions.",
      },
      {
        role: "user",
        content: JSON.stringify({
          request: input.request.messages,
          answer: input.response.content,
        }),
      },
    ],
    tools: [],
    temperature: 0,
    normalized_hash: `${input.request.normalized_hash}:verifier`,
  };
  const judgment = await input.provider.complete(judgmentRequest);
  return parseJudgment(judgment.content, input.provider.name);
}

export function parseJudgment(content: string, verifierProvider = "model"): ModelVerifierDecision {
  const text = content.trim();
  const upper = text.toUpperCase();
  if (upper.startsWith("PASS")) {
    return { status: "passed", reason: text, recommended_action: "return", rawJudgment: content, verifierProvider };
  }
  if (upper.startsWith("FAIL")) {
    return { status: "failed", reason: text, recommended_action: "escalate", rawJudgment: content, verifierProvider };
  }
  return { status: "uncertain", reason: text || "model verifier was uncertain", recommended_action: "verify_in_background", rawJudgment: content, verifierProvider };
}

export function semanticCacheDecisionFromVerifier(decision: ModelVerifierDecision): {
  serve: boolean;
  backgroundVerify: boolean;
  reason: string;
} {
  if (decision.status === "passed") return { serve: true, backgroundVerify: false, reason: decision.reason };
  if (decision.status === "uncertain") return { serve: false, backgroundVerify: true, reason: decision.reason };
  return { serve: false, backgroundVerify: false, reason: decision.reason };
}
