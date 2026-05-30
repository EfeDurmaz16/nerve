import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SemanticCache } from "@tokenops/cache";
import { type ModelResponse } from "@tokenops/core";
import { normalizeOpenAIChatRequest } from "@tokenops/gateway";
import { classifyCacheability } from "@tokenops/profiler";

export type SemanticSafetyExpectation = "safe_hit" | "blocked";

export interface SemanticSafetyCase {
  id: string;
  seed: unknown;
  probe: unknown;
  expected: SemanticSafetyExpectation;
}

export interface SemanticSafetyCaseResult {
  id: string;
  expected: SemanticSafetyExpectation;
  seedCacheability: string;
  probeCacheability: string;
  hit: boolean;
  passed: boolean;
  reason: string;
}

export interface SemanticSafetyBenchmarkResult {
  dataset: string;
  threshold: number;
  totalCases: number;
  safeReuseAttempts: number;
  safeReuseHits: number;
  riskyReuseAttempts: number;
  riskyReuseBlocked: number;
  falsePositiveUnsafeHits: number;
  falseNegativeSafeMisses: number;
  cases: SemanticSafetyCaseResult[];
  passed: boolean;
}

export interface SemanticThresholdSweepResult {
  dataset: string;
  thresholds: SemanticSafetyBenchmarkResult[];
  recommendedThreshold: number | null;
  recommended: SemanticSafetyBenchmarkResult | null;
}

export async function runSemanticCacheSafetyBenchmark(datasetPath: string, opts: { threshold?: number } = {}): Promise<SemanticSafetyBenchmarkResult> {
  const cases = readJsonl(datasetPath);
  const results: SemanticSafetyCaseResult[] = [];
  const threshold = opts.threshold ?? 0.3;

  for (const testCase of cases) {
    const cache = new SemanticCache(threshold);
    const seed = normalizeOpenAIChatRequest(testCase.seed);
    const probe = normalizeOpenAIChatRequest(testCase.probe);
    const response: ModelResponse = {
      id: `semantic_safety_${testCase.id}`,
      model: seed.requested_model,
      provider: "mock",
      content: `cached response for ${testCase.id}`,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
    cache.set(seed, response);
    const hit = cache.get(probe) !== null;
    const seedCacheability = classifyCacheability(seed);
    const probeCacheability = classifyCacheability(probe);
    const passed = testCase.expected === "safe_hit" ? hit && probeCacheability === "semantic_safe" : !hit && probeCacheability !== "semantic_safe";
    results.push({
      id: testCase.id,
      expected: testCase.expected,
      seedCacheability,
      probeCacheability,
      hit,
      passed,
      reason: passed
        ? "semantic cache behavior matched safety expectation"
        : `expected ${testCase.expected}, got hit=${hit} probeCacheability=${probeCacheability}`,
    });
  }

  const safeCases = results.filter((result) => result.expected === "safe_hit");
  const riskyCases = results.filter((result) => result.expected === "blocked");
  const falsePositiveUnsafeHits = riskyCases.filter((result) => result.hit).length;
  const falseNegativeSafeMisses = safeCases.filter((result) => !result.hit).length;

  return {
    dataset: datasetPath,
    threshold,
    totalCases: results.length,
    safeReuseAttempts: safeCases.length,
    safeReuseHits: safeCases.filter((result) => result.hit).length,
    riskyReuseAttempts: riskyCases.length,
    riskyReuseBlocked: riskyCases.filter((result) => !result.hit).length,
    falsePositiveUnsafeHits,
    falseNegativeSafeMisses,
    cases: results,
    passed: results.length > 0 && falsePositiveUnsafeHits === 0 && falseNegativeSafeMisses === 0 && results.every((result) => result.passed),
  };
}

export async function runSemanticCacheThresholdSweep(
  datasetPath: string,
  thresholds = [0.2, 0.3, 0.4, 0.5, 0.7],
): Promise<SemanticThresholdSweepResult> {
  const results = await Promise.all(thresholds.map((threshold) => runSemanticCacheSafetyBenchmark(datasetPath, { threshold })));
  const candidates = results
    .filter((result) => result.falsePositiveUnsafeHits === 0 && result.passed)
    .sort((a, b) => b.safeReuseHits - a.safeReuseHits || a.threshold - b.threshold);
  const recommended = candidates[0] ?? null;
  return {
    dataset: datasetPath,
    thresholds: results,
    recommendedThreshold: recommended?.threshold ?? null,
    recommended,
  };
}

function readJsonl(path: string): SemanticSafetyCase[] {
  return readFileSync(resolve(path), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SemanticSafetyCase);
}
