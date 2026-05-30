import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { contextBlockFingerprints, ExactCache, SemanticCache, simulatePrefixCache, ToolResultCache } from "@tokenops/cache";
import { estimateCost, estimateInputTokens, type BenchmarkResult } from "@tokenops/core";
import { normalizeOpenAIChatRequest } from "@tokenops/gateway";
import { MockProvider } from "@tokenops/providers";
import { classifyWorkload, estimateComplexity } from "@tokenops/profiler";
import { routeModel } from "@tokenops/router";

export interface DatasetItem {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  expected_cache?: "exact" | "semantic" | "tool" | "context" | "none";
  tool?: { name: string; args: unknown; resource_version: string; result?: unknown };
}

export async function replayDataset(path: string): Promise<BenchmarkResult> {
  const items = readDataset(path);
  const provider = new MockProvider();
  const exact = new ExactCache();
  const semantic = new SemanticCache(0.3);
  const toolCache = new ToolResultCache();
  const seenContext = new Set<string>();
  let exactHits = 0;
  let semanticHits = 0;
  let toolHits = 0;
  let contextHits = 0;
  let downgrades = 0;
  let baselineCost = 0;
  let optimizedCost = 0;
  let baselineInputTokens = 0;
  let optimizedInputTokens = 0;
  let baselineOutputTokens = 0;
  let optimizedOutputTokens = 0;
  let optimizedModelCalls = 0;
  let prefixEligibleTokens = 0;
  let wrongCacheIncidents = 0;
  const latencies: number[] = [];
  const qualityWarnings: string[] = [];

  for (const item of items) {
    const baselineReq = normalizeOpenAIChatRequest(item);
    const baselineInput = estimateInputTokens(baselineReq);
    baselineInputTokens += baselineInput;
    baselineOutputTokens += 512;
    baselineCost += estimateCost(baselineReq.requested_model, baselineInput, 512).totalCostUsd;

    const profile = classifyWorkload(baselineReq);
    const req = { ...baselineReq, workload_type: profile.workloadType, risk_level: profile.riskLevel };
    const route = routeModel({ request: req, workloadType: profile.workloadType, complexity: estimateComplexity(req), riskLevel: profile.riskLevel });
    if (route.downgraded) downgrades++;

    const prefix = simulatePrefixCache(req);
    prefixEligibleTokens += prefix.cachedPrefixEligibleTokens;
    const contextKey = Object.values(contextBlockFingerprints(req)).join("|");
    const hasReusableContext = seenContext.has(contextKey) && contextKey.length > 0;
    if (hasReusableContext) contextHits++;
    seenContext.add(contextKey);

    if (item.tool) {
      const cached = toolCache.get(item.tool.name, item.tool.args, item.tool.resource_version);
      if (cached) toolHits++;
      else toolCache.set(item.tool.name, item.tool.args, item.tool.resource_version, item.tool.result ?? { ok: true });
    } else if (item.expected_cache === "tool") {
      const content = JSON.stringify(req.messages);
      const cached = toolCache.get("synthetic_tool", { content }, "dataset");
      if (cached) toolHits++;
      else toolCache.set("synthetic_tool", { content }, "dataset", { ok: true });
    }

    let response = exact.get(req);
    let hitKind: "exact" | "semantic" | "none" = "none";
    if (response) {
      exactHits++;
      hitKind = "exact";
    }
    if (!response) {
      response = semantic.get(req);
      if (response) {
        semanticHits++;
        hitKind = "semantic";
      }
    }
    if (!response) {
      response = await provider.complete({ ...req, requested_model: route.selectedModel });
      optimizedModelCalls++;
      exact.set(req, response);
      semantic.set(req, response);
      optimizedCost += estimateCost(route.selectedModel, estimateInputTokens(req), response.output_tokens).totalCostUsd;
      optimizedInputTokens += estimateInputTokens(req);
      optimizedOutputTokens += response.output_tokens;
      latencies.push(response.latency_ms);
    } else {
      latencies.push(20);
    }

    if (item.expected_cache === "none" && hitKind !== "none") wrongCacheIncidents++;
  }

  latencies.sort((a, b) => a - b);
  const total = items.length;
  return {
    dataset: basename(path),
    total_requests: total,
    baseline_cost: round6(baselineCost),
    optimized_cost: round6(optimizedCost),
    estimated_savings: round6(Math.max(0, baselineCost - optimizedCost)),
    exact_cache_hit_rate: rate(exactHits, total),
    semantic_cache_hit_rate: rate(semanticHits, total),
    tool_result_reuse_rate: rate(toolHits, total),
    model_downgrade_rate: rate(downgrades, total),
    verifier_escalation_rate: 0,
    p50_latency_estimate: percentile(latencies, 0.5),
    p95_latency_estimate: percentile(latencies, 0.95),
    wrong_cache_incidents: wrongCacheIncidents,
    baseline_model_calls: total,
    optimized_model_calls: optimizedModelCalls,
    context_block_reuse_rate: rate(contextHits, total),
    estimated_input_tokens_saved: Math.max(0, baselineInputTokens - optimizedInputTokens),
    estimated_output_tokens_saved: Math.max(0, baselineOutputTokens - optimizedOutputTokens),
    prefix_cache_eligible_tokens: prefixEligibleTokens,
    quality_warnings: qualityWarnings,
  };
}

export async function replayAll(dir = "benchmark/datasets"): Promise<BenchmarkResult[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const out: BenchmarkResult[] = [];
  for (const file of files) out.push(await replayDataset(join(dir, file)));
  return out;
}

function readDataset(path: string): DatasetItem[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as DatasetItem);
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 10_000) / 10_000;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * p))]!;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
