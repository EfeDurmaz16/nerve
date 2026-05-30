import type { ModelResponse, NormalizedRequest } from "@tokenops/core";
import type { ModelProvider } from "./provider.js";

export interface RetryProviderOptions {
  retries?: number;
  timeoutMs?: number;
}

export class RetryProvider implements ModelProvider {
  readonly name: string;
  private readonly retries: number;
  private readonly timeoutMs: number;

  constructor(private readonly provider: ModelProvider, opts: RetryProviderOptions = {}) {
    this.name = provider.name;
    this.retries = opts.retries ?? 1;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    const errors: string[] = [];
    for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
      const controller = new AbortController();
      try {
        const response = await withTimeout(
          this.provider.complete(request, { signal: controller.signal }),
          this.timeoutMs,
          `${this.provider.name} timed out after ${this.timeoutMs}ms`,
          controller,
        );
        return {
          ...response,
          raw: {
            ...(isRecord(response.raw) ? response.raw : {}),
            tokenops: {
              retry: {
                attempts: attempt,
                errors,
              },
            },
          },
        };
      } catch (error) {
        controller.abort();
        errors.push((error as Error).message);
        if (attempt > this.retries) break;
      }
    }
    throw new Error(`${this.provider.name} failed after ${this.retries + 1} attempts: ${errors.join("; ")}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, controller: AbortController): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
