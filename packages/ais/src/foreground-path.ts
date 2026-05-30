import type { ForegroundAction } from "@tokenops/core";

export function foregroundFor(input: { exactHit: boolean; semanticHit: boolean; budgetAllowed: boolean }): ForegroundAction {
  if (!input.budgetAllowed) return "block_budget";
  if (input.exactHit) return "serve_exact_cache";
  if (input.semanticHit) return "serve_semantic_cache";
  return "call_model";
}
