import type { Complexity, NormalizedRequest } from "@tokenops/core";
import { estimateInputTokens } from "@tokenops/core";

export function estimateComplexity(request: NormalizedRequest): Complexity {
  const tokens = estimateInputTokens(request);
  if (tokens > 8000 || request.tools.length > 5) return "high";
  if (tokens > 1500 || request.tools.length > 0) return "medium";
  return "low";
}
