import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export interface ServingVerifierResult {
  status: "passed" | "failed" | "uncertain";
  reason: string;
  recommended_action: "return" | "escalate" | "verify_in_background";
}

export function verifyResponse(request: NormalizedRequest, response: ModelResponse): ServingVerifierResult {
  const text = response.content.toLowerCase();
  if (/error:|timeout|cannot comply/.test(text)) return { status: "failed", reason: "response contains failure marker", recommended_action: "escalate" };
  if (request.risk_level === "high") return { status: "uncertain", reason: "high-risk response needs stronger verification", recommended_action: "escalate" };
  return { status: "passed", reason: "heuristic verifier passed", recommended_action: "return" };
}
