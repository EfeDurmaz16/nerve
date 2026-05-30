import type { NormalizedRequest } from "@tokenops/core";
import { classifyCacheability } from "@tokenops/profiler";

export function canUseSemanticCache(request: NormalizedRequest): boolean {
  return classifyCacheability(request) === "semantic_safe";
}

export function canUseExactCache(_request: NormalizedRequest): boolean {
  return true;
}
