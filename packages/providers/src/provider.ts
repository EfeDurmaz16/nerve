import type { CostEstimate, ModelResponse, NormalizedRequest } from "@tokenops/core";

export interface ModelProvider {
  name: string;
  complete(request: NormalizedRequest, opts?: { signal?: AbortSignal }): Promise<ModelResponse>;
  estimateCost?(request: NormalizedRequest): CostEstimate;
}

export class ProviderConfigError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
    this.name = "ProviderConfigError";
  }
}

export function providerErrorMessage(provider: string, status: number, body: string): string {
  const safeBody = body
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]")
    .replace(/gsk_[A-Za-z0-9_\-]+/g, "gsk_[REDACTED]")
    .replace(/sk-[A-Za-z0-9_\-]+/g, "sk-[REDACTED]")
    .slice(0, 500);
  return `${provider}: upstream request failed (${status}): ${safeBody}`;
}
