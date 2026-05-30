import { estimateInputTokens, estimateTextTokens } from "@tokenops/core";
import type { ModelProvider } from "./provider.js";
import { ProviderConfigError, providerErrorMessage } from "./provider.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export interface OllamaProviderOptions {
  baseUrl?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  model?: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    this.defaultModel = opts.defaultModel ?? process.env.OLLAMA_MODEL ?? "llama3.2";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(request: NormalizedRequest, opts: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    const started = Date.now();
    const model = request.requested_model === "local" || request.requested_model === "mock" ? this.defaultModel : request.requested_model;
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "") })),
        stream: false,
        options: { temperature: request.temperature },
      }),
      signal: opts.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderConfigError(this.name, providerErrorMessage(this.name, res.status, text));
    const json = JSON.parse(text) as OllamaChatResponse;
    const content = json.message?.content ?? "";
    return {
      id: `ollama_${Date.now()}`,
      model: json.model ?? model,
      provider: this.name,
      content,
      finish_reason: json.done === false ? "length" : "stop",
      input_tokens: json.prompt_eval_count ?? estimateInputTokens(request),
      output_tokens: json.eval_count ?? estimateTextTokens(content),
      latency_ms: Math.max(1, Date.now() - started),
      cost_usd: 0,
      raw: json,
    };
  }
}
