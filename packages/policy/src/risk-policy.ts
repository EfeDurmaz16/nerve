import type { RiskLevel } from "@tokenops/core";

export function requiresVerifier(risk: RiskLevel): boolean {
  return risk === "high";
}
