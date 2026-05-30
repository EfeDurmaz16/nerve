import type { ModelProvider } from "@tokenops/providers";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";
import { verifyResponse } from "./verifier.js";

export async function cheapThenVerify(input: {
  request: NormalizedRequest;
  cheapProvider: ModelProvider;
  strongProvider: ModelProvider;
}): Promise<{ response: ModelResponse; verifierPassed: boolean; escalatedAfterFail: boolean }> {
  const cheap = await input.cheapProvider.complete(input.request);
  const verdict = verifyResponse(input.request, cheap);
  if (verdict.status === "passed") return { response: cheap, verifierPassed: true, escalatedAfterFail: false };
  const strong = await input.strongProvider.complete({ ...input.request, requested_model: "gpt-5.5" });
  return { response: strong, verifierPassed: false, escalatedAfterFail: true };
}
