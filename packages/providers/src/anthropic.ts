import type { ModelProvider } from "./provider.js";
import { ProviderConfigError } from "./provider.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  async complete(_request: NormalizedRequest): Promise<ModelResponse> {
    if (!process.env.ANTHROPIC_API_KEY) throw new ProviderConfigError(this.name, "ANTHROPIC_API_KEY is not set");
    throw new ProviderConfigError(this.name, "real Anthropic adapter is not implemented in the local MVP");
  }
}
