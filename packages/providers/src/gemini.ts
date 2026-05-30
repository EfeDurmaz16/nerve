import type { ModelProvider } from "./provider.js";
import { ProviderConfigError } from "./provider.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export class GeminiProvider implements ModelProvider {
  readonly name = "gemini";
  async complete(_request: NormalizedRequest): Promise<ModelResponse> {
    if (!process.env.GEMINI_API_KEY) throw new ProviderConfigError(this.name, "GEMINI_API_KEY is not set");
    throw new ProviderConfigError(this.name, "real Gemini adapter is not implemented in the local MVP");
  }
}
