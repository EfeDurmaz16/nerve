import type { Cacheability, NormalizedRequest } from "@tokenops/core";
import { messageToText } from "@tokenops/core";
import { classifyWorkload } from "./workload-classifier.js";

export function classifyCacheability(request: NormalizedRequest): Cacheability {
  const profile = classifyWorkload(request);
  const text = request.messages.map(messageToText).join("\n").toLowerCase();
  if (/private|password|token|secret|credential|medical|legal|financial|payment|wire|security/.test(text)) return "never_cache";
  if (profile.workloadType === "code_modification" || profile.workloadType === "high_risk_action") return "private_or_risky";
  if (["docs_qa", "support_faq", "summarization", "classification"].includes(profile.workloadType)) return "semantic_safe";
  if (request.tools.length > 0) return "tool_safe";
  return "exact_safe";
}
