import { normalizeChatCompletionRequest, stableRequestHash, type ModelResponse, type NormalizedRequest } from "@tokenops/core";
import type { ModelProvider } from "@tokenops/providers";
import { CircuitOpenError, InferenceRuntime, type RuntimeStats } from "@tokenops/runtime";

export interface ProviderFailoverBenchmarkOptions {
  requests?: number;
  primaryFailuresBeforeSuccess?: number;
  circuitFailureThreshold?: number;
  fallbackLatencyMs?: number;
}

export interface ProviderFailoverBenchmarkResult {
  requests: number;
  primaryFailuresBeforeSuccess: number;
  circuitFailureThreshold: number;
  successfulResponses: number;
  failedResponses: number;
  primaryProviderCalls: number;
  fallbackProviderCalls: number;
  circuitRejectedRequests: number;
  fallbackRecoveries: number;
  circuitOpened: boolean;
  p50LatencyMs: number;
  p95LatencyMs: number;
  runtime: RuntimeStats;
}

export async function runProviderFailoverBenchmark(opts: ProviderFailoverBenchmarkOptions = {}): Promise<ProviderFailoverBenchmarkResult> {
  const requests = opts.requests ?? 12;
  const primaryFailuresBeforeSuccess = opts.primaryFailuresBeforeSuccess ?? requests;
  const circuitFailureThreshold = opts.circuitFailureThreshold ?? 2;
  const runtime = new InferenceRuntime({
    maxConcurrent: 1,
    maxQueue: requests,
    circuitFailureThreshold,
    circuitCooldownMs: 60_000,
  });
  const primary = new FlakyProvider("primary", primaryFailuresBeforeSuccess);
  const fallback = new LatencyProvider("fallback", opts.fallbackLatencyMs ?? 1);
  const latencies: number[] = [];
  let successfulResponses = 0;
  let failedResponses = 0;
  let circuitRejectedRequests = 0;
  let fallbackRecoveries = 0;

  for (let index = 0; index < requests; index++) {
    const request = requestFor(index);
    const started = Date.now();
    try {
      await runtime.execute({
        providerKey: primary.name,
        coalesceKey: [primary.name, request.normalized_hash].join(":"),
        run: () => primary.complete(request),
      });
      successfulResponses += 1;
    } catch (error) {
      if (error instanceof CircuitOpenError) circuitRejectedRequests += 1;
      try {
        await fallback.complete({ ...request, provider: fallback.name });
        successfulResponses += 1;
        fallbackRecoveries += 1;
      } catch {
        failedResponses += 1;
      }
    } finally {
      latencies.push(Date.now() - started);
    }
  }

  latencies.sort((a, b) => a - b);
  const runtimeStats = runtime.stats();
  const primaryCircuit = runtimeStats.circuits[primary.name];
  return {
    requests,
    primaryFailuresBeforeSuccess,
    circuitFailureThreshold,
    successfulResponses,
    failedResponses,
    primaryProviderCalls: primary.calls,
    fallbackProviderCalls: fallback.calls,
    circuitRejectedRequests,
    fallbackRecoveries,
    circuitOpened: primaryCircuit?.state === "open",
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    runtime: runtimeStats,
  };
}

function requestFor(index: number): NormalizedRequest {
  const request = normalizeChatCompletionRequest({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: `failover benchmark prompt ${index}` }],
  }, { provider: "primary", workloadType: "docs_qa", riskLevel: "low" });
  return { ...request, normalized_hash: stableRequestHash(request) };
}

class FlakyProvider implements ModelProvider {
  calls = 0;
  constructor(readonly name: string, private failuresBeforeSuccess: number) {
  }

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    this.calls += 1;
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new Error(`${this.name} synthetic failure`);
    }
    return modelResponse(request, this.name, `primary response for ${request.id}`);
  }
}

class LatencyProvider implements ModelProvider {
  calls = 0;
  constructor(readonly name: string, private readonly latencyMs: number) {
  }

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    this.calls += 1;
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return modelResponse(request, this.name, `fallback response for ${request.id}`);
  }
}

function modelResponse(request: NormalizedRequest, provider: string, content: string): ModelResponse {
  return {
    id: `${provider}_${request.id}`,
    model: request.requested_model,
    provider,
    content,
    finish_reason: "stop",
    input_tokens: 1,
    output_tokens: 1,
    latency_ms: 1,
    cost_usd: 0,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
}
