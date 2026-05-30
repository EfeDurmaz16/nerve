import type { ModelProvider } from "./provider.js";
import { ProviderConfigError } from "./provider.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export class VllmProvider implements ModelProvider {
  readonly name = "vllm";
  async complete(_request: NormalizedRequest): Promise<ModelResponse> {
    throw new ProviderConfigError(this.name, "vLLM adapter is scaffolded but not implemented in the local MVP");
  }
}
