export interface QuotaDecision {
  allowed: boolean;
  reason: string;
}

export function evaluateQuota(count: number, max: number): QuotaDecision {
  return count >= max ? { allowed: false, reason: "quota exceeded" } : { allowed: true, reason: "quota available" };
}
