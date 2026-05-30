import { ulid } from "ulid";
import { estimateCost, estimateInputTokens, estimateTextTokens } from "@tokenops/core";
import type { ModelProvider } from "./provider.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export class MockProvider implements ModelProvider {
  readonly name = "mock";

  async complete(request: NormalizedRequest, opts: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    const started = Date.now();
    if (opts.signal?.aborted) throw new Error("mock provider aborted");
    const delayMs = Number(process.env.TOKENOPS_MOCK_DELAY_MS ?? 0);
    if (delayMs > 0) await delay(delayMs, opts.signal);
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const text = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
    const content = `Mock TokenOps response for ${request.workload_type}: ${text.slice(0, 120)}`;
    const input = estimateInputTokens(request);
    const output = estimateTextTokens(content);
    return {
      id: `chatcmpl_${ulid()}`,
      model: request.requested_model === "mock" ? "mock" : request.requested_model,
      provider: this.name,
      content,
      finish_reason: "stop",
      input_tokens: input,
      output_tokens: output,
      latency_ms: Math.max(1, Date.now() - started),
      cost_usd: estimateCost(request.requested_model, input, output).totalCostUsd,
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("mock provider aborted"));
    }, { once: true });
  });
}
