import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CostEstimate } from "./types.js";

export interface ModelPrice {
  input: number;
  output: number;
}

export type PricingTable = Record<string, ModelPrice>;

const DEFAULT_PRICING: PricingTable = {
  "gpt-5.5": { input: 5.0, output: 15.0 },
  "gpt-5-mini": { input: 0.2, output: 0.8 },
  "claude-opus": { input: 15.0, output: 75.0 },
  "claude-haiku": { input: 0.8, output: 4.0 },
  "gemini-flash": { input: 0.1, output: 0.4 },
  local: { input: 0, output: 0 },
  mock: { input: 0, output: 0 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
};

export function loadPricing(path = resolve(process.cwd(), "config/pricing.json")): PricingTable {
  try {
    return { ...DEFAULT_PRICING, ...(JSON.parse(readFileSync(path, "utf8")) as PricingTable) };
  } catch {
    return DEFAULT_PRICING;
  }
}

export function priceForModel(model: string, pricing: PricingTable = loadPricing()): ModelPrice {
  return pricing[model] ?? pricing.local ?? { input: 0, output: 0 };
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: PricingTable = loadPricing(),
): CostEstimate {
  const price = priceForModel(model, pricing);
  const inputCostUsd = (inputTokens / 1_000_000) * price.input;
  const outputCostUsd = (outputTokens / 1_000_000) * price.output;
  return {
    inputTokens,
    outputTokens,
    inputCostUsd: round6(inputCostUsd),
    outputCostUsd: round6(outputCostUsd),
    totalCostUsd: round6(inputCostUsd + outputCostUsd),
  };
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
