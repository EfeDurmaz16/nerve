import { estimateCost, estimateInputTokens, estimateTextTokens } from "@tokenops/core";
import type { ModelProvider } from "./provider.js";
import { ProviderConfigError, providerErrorMessage } from "./provider.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(request: NormalizedRequest, opts: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    if (!this.apiKey) throw new ProviderConfigError(this.name, "OPENAI_API_KEY is not set");
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.requested_model,
        messages: request.messages,
        tools: request.tools.length > 0 ? request.tools : undefined,
        temperature: request.temperature,
        response_format: request.response_format ?? undefined,
        max_tokens: request.max_output_tokens,
      }),
      signal: opts.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderConfigError(this.name, providerErrorMessage(this.name, res.status, text));
    const json = JSON.parse(text) as OpenAIChatResponse;
    const content = json.choices?.[0]?.message?.content ?? "";
    const inputTokens = json.usage?.prompt_tokens ?? estimateInputTokens(request);
    const outputTokens = json.usage?.completion_tokens ?? estimateTextTokens(content);
    const model = json.model ?? request.requested_model;
    return {
      id: json.id ?? `openai_${Date.now()}`,
      model,
      provider: this.name,
      content,
      finish_reason: json.choices?.[0]?.finish_reason ?? "stop",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Math.max(1, Date.now() - started),
      cost_usd: estimateCost(model, inputTokens, outputTokens).totalCostUsd,
      raw: json,
    };
  }
}
