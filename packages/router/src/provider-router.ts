import { FallbackProvider, GroqProvider, MockProvider, OllamaProvider, OpenAIProvider, RetryProvider, type ModelProvider } from "@tokenops/providers";

export function providerFor(name: string): ModelProvider {
  const names = name.split(",").map((part) => part.trim()).filter(Boolean);
  if (names.length > 1) return new FallbackProvider(names.map((providerName) => providerFor(providerName)));
  if (name === "groq") return withRetry(new GroqProvider());
  if (name === "openai") return withRetry(new OpenAIProvider());
  if (name === "ollama") return withRetry(new OllamaProvider());
  if (name === "mock") return withRetry(new MockProvider());
  return withRetry(new MockProvider());
}

function withRetry(provider: ModelProvider): ModelProvider {
  return new RetryProvider(provider, {
    retries: Number(process.env.TOKENOPS_PROVIDER_RETRIES ?? 1),
    timeoutMs: Number(process.env.TOKENOPS_PROVIDER_TIMEOUT_MS ?? 30_000),
  });
}
