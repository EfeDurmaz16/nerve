import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { FallbackProvider, GroqProvider, MockProvider, OllamaProvider, OpenAIProvider, RetryProvider } from "./src/index.js";
import type { ModelProvider } from "./src/index.js";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

describe("TokenOps providers", () => {
  it("mock provider returns a model response", async () => {
    const provider = new MockProvider();
    const req = normalizeChatCompletionRequest({ model: "mock", messages: [{ role: "user", content: "hello" }] });
    const out = await provider.complete(req);
    expect(out.provider).toBe("mock");
    expect(out.content).toContain("Mock TokenOps response");
  });

  it("provider adapter config errors do not echo secrets", async () => {
    const provider = new OpenAIProvider();
    const req = normalizeChatCompletionRequest({ model: "gpt-5.5", messages: [{ role: "user", content: "secret" }] });
    await expect(provider.complete(req)).rejects.toThrow("OPENAI_API_KEY is not set");
  });

  it("calls Groq OpenAI-compatible chat completions without echoing the key", async () => {
    const calls: Array<{ url: string; body: any; authorization?: string }> = [];
    const provider = new GroqProvider({
      apiKey: "gsk_test_secret",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          authorization: init?.headers instanceof Headers ? init.headers.get("authorization") ?? undefined : (init?.headers as Record<string, string>).authorization,
        });
        return new Response(JSON.stringify({
          id: "chatcmpl_groq",
          model: "llama-3.3-70b-versatile",
          choices: [{ message: { content: "real groq response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 4 },
        }), { status: 200 });
      }) as typeof fetch,
    });
    const req = normalizeChatCompletionRequest({ model: "gpt-5.5", messages: [{ role: "user", content: "hello" }] });
    const out = await provider.complete(req);
    expect(out.provider).toBe("groq");
    expect(out.content).toBe("real groq response");
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("llama-3.3-70b-versatile");
    expect(calls[0]!.authorization).toBe("Bearer gsk_test_secret");
  });

  it("calls OpenAI-compatible chat completions with fetch", async () => {
    const calls: Array<{ url: string; body: any; authorization?: string }> = [];
    const provider = new OpenAIProvider({
      apiKey: "sk-test-secret",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          authorization: init?.headers instanceof Headers ? init.headers.get("authorization") ?? undefined : (init?.headers as Record<string, string>).authorization,
        });
        return new Response(JSON.stringify({
          id: "chatcmpl_openai",
          model: "gpt-5-mini",
          choices: [{ message: { content: "openai response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 6, completion_tokens: 3 },
        }), { status: 200 });
      }) as typeof fetch,
    });
    const req = normalizeChatCompletionRequest({ model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] });
    const out = await provider.complete(req);
    expect(out.provider).toBe("openai");
    expect(out.content).toBe("openai response");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.authorization).toBe("Bearer sk-test-secret");
  });

  it("calls Ollama /api/chat and maps usage estimates", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      defaultModel: "llama3.2",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({
          model: "llama3.2",
          message: { role: "assistant", content: "local response" },
          done: true,
          prompt_eval_count: 8,
          eval_count: 4,
        }), { status: 200 });
      }) as typeof fetch,
    });
    const req = normalizeChatCompletionRequest({ model: "local", messages: [{ role: "user", content: "hello" }] });
    const out = await provider.complete(req);
    expect(out.provider).toBe("ollama");
    expect(out.content).toBe("local response");
    expect(out.cost_usd).toBe(0);
    expect(calls[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(calls[0]!.body.stream).toBe(false);
  });

  it("falls back to the next provider when the primary fails", async () => {
    const req = normalizeChatCompletionRequest({ model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] });
    const provider = new FallbackProvider([
      new FailingProvider("primary"),
      new StaticProvider("secondary", "fallback response"),
    ]);
    const out = await provider.complete(req);
    expect(out.provider).toBe("secondary");
    expect((out.raw as { tokenops?: { fallback: unknown } }).tokenops?.fallback).toMatchObject({
      selectedProvider: "secondary",
      failedProviders: ["primary"],
    });
  });

  it("retries transient provider failures", async () => {
    const req = normalizeChatCompletionRequest({ model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] });
    const flaky = new FlakyProvider("flaky", 1);
    const provider = new RetryProvider(flaky, { retries: 2, timeoutMs: 1000 });
    const out = await provider.complete(req);
    expect(out.provider).toBe("flaky");
    expect(flaky.calls).toBe(2);
    expect((out.raw as { tokenops?: { retry: unknown } }).tokenops?.retry).toMatchObject({ attempts: 2 });
  });

  it("aborts provider work when retry timeout fires", async () => {
    const req = normalizeChatCompletionRequest({ model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] });
    const slow = new AbortAwareProvider("slow");
    const provider = new RetryProvider(slow, { retries: 0, timeoutMs: 5 });
    await expect(provider.complete(req)).rejects.toThrow("timed out");
    expect(slow.aborted).toBe(true);
  });
});

class FailingProvider implements ModelProvider {
  constructor(readonly name: string) {}
  async complete(): Promise<ModelResponse> {
    throw new Error(`${this.name} failed`);
  }
}

class StaticProvider implements ModelProvider {
  constructor(readonly name: string, private readonly content: string) {}
  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    return {
      id: `${this.name}_response`,
      model: request.requested_model,
      provider: this.name,
      content: this.content,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}

class FlakyProvider implements ModelProvider {
  calls = 0;
  constructor(readonly name: string, private readonly failuresBeforeSuccess: number) {}
  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    this.calls++;
    if (this.calls <= this.failuresBeforeSuccess) throw new Error("transient failure");
    return {
      id: `${this.name}_response`,
      model: request.requested_model,
      provider: this.name,
      content: "retry response",
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}

class AbortAwareProvider implements ModelProvider {
  aborted = false;
  constructor(readonly name: string) {}

  async complete(_request: NormalizedRequest, opts: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve({
        id: "slow_response",
        model: "gpt-5-mini",
        provider: this.name,
        content: "too slow",
        finish_reason: "stop",
        input_tokens: 1,
        output_tokens: 1,
        latency_ms: 50,
        cost_usd: 0,
      }), 50);
      opts.signal?.addEventListener("abort", () => {
        this.aborted = true;
        clearTimeout(timeout);
        reject(new Error("aborted"));
      }, { once: true });
    });
  }
}
