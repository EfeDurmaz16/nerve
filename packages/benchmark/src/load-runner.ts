import { normalizeChatCompletionRequest, stableRequestHash, type ModelResponse, type NormalizedRequest } from "@tokenops/core";
import { MockProvider } from "@tokenops/providers";
import { InferenceRuntime, type RuntimeStats } from "@tokenops/runtime";

export interface LoadBenchmarkOptions {
  requests?: number;
  concurrency?: number;
  duplicateRatio?: number;
  providerLatencyMs?: number;
  maxConcurrentInference?: number;
  maxQueue?: number;
}

export interface LoadBenchmarkResult {
  requests: number;
  concurrency: number;
  duplicateRatio: number;
  providerLatencyMs: number;
  wallTimeMs: number;
  providerCalls: number;
  coalescedResponses: number;
  avoidedProviderCalls: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  runtime: RuntimeStats;
}

export async function runLoadBenchmark(opts: LoadBenchmarkOptions = {}): Promise<LoadBenchmarkResult> {
  const requests = opts.requests ?? 40;
  const concurrency = opts.concurrency ?? 10;
  const duplicateRatio = clamp(opts.duplicateRatio ?? 0.5, 0, 1);
  const providerLatencyMs = opts.providerLatencyMs ?? 25;
  const runtime = new InferenceRuntime({
    maxConcurrent: opts.maxConcurrentInference ?? concurrency,
    maxQueue: opts.maxQueue ?? requests,
  });
  const provider = new CountingProvider(providerLatencyMs);
  const inputs = Array.from({ length: requests }, (_, index) => requestFor(index, duplicateRatio));
  const latencies: number[] = [];
  let coalescedResponses = 0;
  const started = Date.now();

  for (let offset = 0; offset < inputs.length; offset += concurrency) {
    const chunk = inputs.slice(offset, offset + concurrency);
    await Promise.all(chunk.map(async (request) => {
      const callStarted = Date.now();
      const result = await runtime.execute({
        providerKey: "mock",
        coalesceKey: ["mock", request.requested_model, request.normalized_hash].join(":"),
        run: () => provider.complete(request),
      });
      if (result.coalesced) coalescedResponses += 1;
      latencies.push(Date.now() - callStarted);
    }));
  }

  latencies.sort((a, b) => a - b);
  return {
    requests,
    concurrency,
    duplicateRatio,
    providerLatencyMs,
    wallTimeMs: Date.now() - started,
    providerCalls: provider.calls,
    coalescedResponses,
    avoidedProviderCalls: requests - provider.calls,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    runtime: runtime.stats(),
  };
}

function requestFor(index: number, duplicateRatio: number): NormalizedRequest {
  const duplicateCount = Math.max(1, Math.floor(1 / Math.max(0.01, 1 - duplicateRatio)));
  const promptIndex = index < Math.floor(1000 * duplicateRatio) ? index % duplicateCount : index;
  const request = normalizeChatCompletionRequest({
    model: "mock",
    messages: [{ role: "user", content: `load benchmark prompt ${promptIndex}` }],
  });
  return { ...request, normalized_hash: stableRequestHash(request) };
}

class CountingProvider extends MockProvider {
  calls = 0;
  constructor(private readonly latencyMs: number) {
    super();
  }

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return super.complete(request);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
