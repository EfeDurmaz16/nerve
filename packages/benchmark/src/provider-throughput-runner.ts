import { normalizeChatCompletionRequest, stableRequestHash, type ModelResponse, type NormalizedRequest } from "@tokenops/core";
import { GroqProvider, MockProvider, OllamaProvider, type ModelProvider } from "@tokenops/providers";
import { InferenceRuntime, type RuntimeStats } from "@tokenops/runtime";

export type ThroughputProvider = "mock" | "ollama" | "groq";

export interface ProviderThroughputOptions {
  provider?: ThroughputProvider;
  model?: string;
  requests?: number;
  concurrency?: number;
  providerLatencyMs?: number;
  maxConcurrentInference?: number;
  maxQueue?: number;
  baseUrl?: string;
  apiKey?: string;
  availabilityTimeoutMs?: number;
}

export interface ProviderThroughputResult {
  provider: ThroughputProvider;
  model: string;
  skipped: boolean;
  skipReason?: string;
  expectedCommand?: string;
  requests: number;
  concurrency: number;
  wallTimeMs: number;
  providerCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  outputTokensPerSecond: number;
  totalTokensPerSecond: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errors: number;
  sampleErrors: string[];
  runtime: RuntimeStats;
}

export async function runProviderThroughputBenchmark(opts: ProviderThroughputOptions = {}): Promise<ProviderThroughputResult> {
  const providerName = opts.provider ?? "mock";
  const requests = opts.requests ?? 24;
  const concurrency = opts.concurrency ?? 6;
  const model = opts.model ?? defaultModelFor(providerName);
  const runtime = new InferenceRuntime({
    maxConcurrent: opts.maxConcurrentInference ?? concurrency,
    maxQueue: opts.maxQueue ?? requests,
  });

  if (providerName === "ollama") {
    const available = await checkOllamaAvailability(opts.baseUrl, opts.availabilityTimeoutMs ?? 750);
    if (!available.ok) {
      return emptyResult({
        provider: providerName,
        model,
        requests,
        concurrency,
        runtime,
        skipReason: `Ollama is not available at ${available.baseUrl}: ${available.reason}`,
        expectedCommand: "ollama serve",
      });
    }
  }
  if (providerName === "groq") {
    const apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
    if (!apiKey) {
      return emptyResult({
        provider: providerName,
        model,
        requests,
        concurrency,
        runtime,
        skipReason: "GROQ_API_KEY is missing from environment or .env",
        expectedCommand: "GROQ_API_KEY=... TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts throughput groq",
      });
    }
  }

  const provider = providerForThroughput(providerName, opts, model);
  const inputs = Array.from({ length: requests }, (_, index) => requestFor(providerName, model, index));
  const latencies: number[] = [];
  const sampleErrors: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const started = Date.now();

  for (let offset = 0; offset < inputs.length; offset += concurrency) {
    const chunk = inputs.slice(offset, offset + concurrency);
    await Promise.all(chunk.map(async (request) => {
      const callStarted = Date.now();
      try {
        const result = await runtime.execute({
          providerKey: providerName,
          coalesceKey: `${providerName}:${request.id}`,
          run: () => provider.complete(request),
        });
        totalInputTokens += result.value.input_tokens;
        totalOutputTokens += result.value.output_tokens;
      } catch (error) {
        if (sampleErrors.length < 5) sampleErrors.push(error instanceof Error ? error.message : String(error));
      } finally {
        latencies.push(Date.now() - callStarted);
      }
    }));
  }

  const wallTimeMs = Math.max(1, Date.now() - started);
  latencies.sort((a, b) => a - b);
  const totalTokens = totalInputTokens + totalOutputTokens;
  return {
    provider: providerName,
    model,
    skipped: false,
    requests,
    concurrency,
    wallTimeMs,
    providerCalls: provider.calls,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    outputTokensPerSecond: roundRate(totalOutputTokens, wallTimeMs),
    totalTokensPerSecond: roundRate(totalTokens, wallTimeMs),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    errors: sampleErrors.length,
    sampleErrors,
    runtime: runtime.stats(),
  };
}

function defaultModelFor(provider: ThroughputProvider): string {
  if (provider === "ollama") return process.env.OLLAMA_MODEL ?? "llama3.2";
  if (provider === "groq") return process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  return "mock";
}

function providerForThroughput(provider: ThroughputProvider, opts: ProviderThroughputOptions, model: string): CountingProvider {
  if (provider === "ollama") return new CountingProvider(new OllamaProvider({ baseUrl: opts.baseUrl, defaultModel: model }), 0);
  if (provider === "groq") return new CountingProvider(new GroqProvider({ apiKey: opts.apiKey, baseUrl: opts.baseUrl, defaultModel: model }), 0);
  return new CountingProvider(new MockProvider(), opts.providerLatencyMs ?? 0);
}

function requestFor(provider: ThroughputProvider, model: string, index: number): NormalizedRequest {
  const request = normalizeChatCompletionRequest({
    model: provider === "ollama" ? "local" : model,
    messages: [
      { role: "system", content: "Answer briefly. This is a TokenOps provider throughput benchmark." },
      { role: "user", content: `Throughput probe ${index}: explain prefix caching in one sentence.` },
    ],
    temperature: 0,
  }, { provider, workloadType: "docs_qa", riskLevel: "low" });
  return { ...request, normalized_hash: stableRequestHash(request) };
}

async function checkOllamaAvailability(baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434", timeoutMs: number): Promise<{ ok: boolean; baseUrl: string; reason: string }> {
  const url = baseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, baseUrl: url, reason: res.ok ? "ok" : `HTTP ${res.status}: ${text.slice(0, 120)}` };
  } catch (error) {
    return { ok: false, baseUrl: url, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function emptyResult(input: {
  provider: ThroughputProvider;
  model: string;
  requests: number;
  concurrency: number;
  runtime: InferenceRuntime;
  skipReason: string;
  expectedCommand: string;
}): ProviderThroughputResult {
  return {
    provider: input.provider,
    model: input.model,
    skipped: true,
    skipReason: input.skipReason,
    expectedCommand: input.expectedCommand,
    requests: input.requests,
    concurrency: input.concurrency,
    wallTimeMs: 0,
    providerCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    outputTokensPerSecond: 0,
    totalTokensPerSecond: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    errors: 0,
    sampleErrors: [],
    runtime: input.runtime.stats(),
  };
}

class CountingProvider implements ModelProvider {
  calls = 0;
  readonly name: string;

  constructor(private readonly inner: ModelProvider, private readonly latencyMs: number) {
    this.name = inner.name;
  }

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    this.calls += 1;
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return this.inner.complete(request);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
}

function roundRate(tokens: number, wallTimeMs: number): number {
  return Number(((tokens / Math.max(1, wallTimeMs)) * 1000).toFixed(2));
}
