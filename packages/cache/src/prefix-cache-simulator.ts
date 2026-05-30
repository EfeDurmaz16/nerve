import { estimateTextTokens, type NormalizedRequest } from "@tokenops/core";

export interface PrefixCacheSimulation {
  prefixTokens: number;
  variableSuffixTokens: number;
  cachedPrefixEligibleTokens: number;
  estimatedProviderCacheCost: number;
  estimatedSavings: number;
}

export function simulatePrefixCache(request: NormalizedRequest): PrefixCacheSimulation {
  const system = request.messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
  const tools = request.tools.length ? JSON.stringify(request.tools) : "";
  const prefixTokens = estimateTextTokens(`${system}\n${tools}`);
  const suffixTokens = Math.max(0, request.messages.reduce((s, m) => s + estimateTextTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)), 0) - prefixTokens);
  const eligible = prefixTokens >= 128 ? prefixTokens : 0;
  return {
    prefixTokens,
    variableSuffixTokens: suffixTokens,
    cachedPrefixEligibleTokens: eligible,
    estimatedProviderCacheCost: eligible * 0.25,
    estimatedSavings: eligible * 0.75,
  };
}
