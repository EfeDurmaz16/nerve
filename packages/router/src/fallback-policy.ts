import type { RiskLevel } from "@tokenops/core";

export function fallbackForRisk(risk: RiskLevel): string | undefined {
  if (risk === "high") return "gpt-5.5";
  if (risk === "medium") return "gpt-5-mini";
  return undefined;
}
