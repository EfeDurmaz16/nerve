import type { ModelResponse, NormalizedRequest } from "@tokenops/core";
import type { ModelProvider } from "./provider.js";

export interface FallbackAttempt {
  provider: string;
  ok: boolean;
  error?: string;
}

export class FallbackProvider implements ModelProvider {
  readonly name = "fallback";

  constructor(private readonly providers: ModelProvider[]) {
    if (providers.length === 0) throw new Error("FallbackProvider requires at least one provider");
  }

  async complete(request: NormalizedRequest, opts: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    const attempts: FallbackAttempt[] = [];
    for (const provider of this.providers) {
      try {
        const response = await provider.complete({ ...request, provider: provider.name }, opts);
        attempts.push({ provider: provider.name, ok: true });
        return {
          ...response,
          raw: {
            ...(isRecord(response.raw) ? response.raw : {}),
            tokenops: {
              ...(isRecord(response.raw) && isRecord(response.raw.tokenops) ? response.raw.tokenops : {}),
              fallback: {
                selectedProvider: provider.name,
                failedProviders: attempts.filter((a) => !a.ok).map((a) => a.provider),
                attempts,
              },
            },
          },
        };
      } catch (error) {
        attempts.push({ provider: provider.name, ok: false, error: (error as Error).message });
      }
    }
    throw new Error(`all providers failed: ${attempts.map((a) => `${a.provider}: ${a.error ?? "unknown"}`).join("; ")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
