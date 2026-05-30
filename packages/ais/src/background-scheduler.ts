import type { BackgroundTask, RiskLevel } from "@tokenops/core";

export function backgroundTasksFor(input: { semanticHit: boolean; riskLevel: RiskLevel; repeatedContextTokens: number }): BackgroundTask[] {
  const tasks: BackgroundTask[] = [];
  if (input.semanticHit) tasks.push("verify_cached_answer");
  if (input.riskLevel !== "low") tasks.push("evaluate_quality");
  if (input.repeatedContextTokens > 1000) tasks.push("compress_trace", "precompute_context");
  return tasks;
}
