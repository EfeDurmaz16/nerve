import { estimateCost, estimateInputTokens, estimateTextTokens } from "@tokenops/core";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";
import type { ModelProvider } from "./provider.js";
import { ProviderConfigError, providerErrorMessage } from "./provider.js";

export interface GroqProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
}

interface GroqChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class GroqProvider implements ModelProvider {
  readonly name = "groq";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GroqProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
    this.baseUrl = (opts.baseUrl ?? process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
    this.defaultModel = opts.defaultModel ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(request: NormalizedRequest, opts: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    if (!this.apiKey) throw new ProviderConfigError(this.name, "GROQ_API_KEY is not set");
    const started = Date.now();
    const model = this.mapModel(request.requested_model);
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
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
    const json = JSON.parse(text) as GroqChatResponse;
    const content = json.choices?.[0]?.message?.content ?? "";
    const inputTokens = json.usage?.prompt_tokens ?? estimateInputTokens(request);
    const outputTokens = json.usage?.completion_tokens ?? estimateTextTokens(content);
    return {
      id: json.id ?? `groq_${Date.now()}`,
      model: json.model ?? model,
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

  private mapModel(model: string): string {
    if (process.env.GROQ_MODEL) return process.env.GROQ_MODEL;
    if (/^(llama|mixtral|gemma|qwen|deepseek|meta-llama|openai)\//.test(model)) return model;
    if (/^(llama|mixtral|gemma|qwen|deepseek)/.test(model)) return model;
    return this.defaultModel;
  }
}
