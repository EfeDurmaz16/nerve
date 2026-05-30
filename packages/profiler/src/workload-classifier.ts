import type { NormalizedRequest, RiskLevel, WorkloadType } from "@tokenops/core";
import { messageToText } from "@tokenops/core";

export interface WorkloadProfile {
  workloadType: WorkloadType;
  riskLevel: RiskLevel;
  cacheability: "safe" | "risky" | "never";
  complexity: "low" | "medium" | "high";
  recommendedPath: string;
}

export function classifyWorkload(request: NormalizedRequest): WorkloadProfile {
  const text = request.messages.map(messageToText).join("\n").toLowerCase();
  let workloadType: WorkloadType = "chat";
  if (/summari[sz]e|tl;dr/.test(text)) workloadType = "summarization";
  if (/docs|documentation|api reference|quickstart/.test(text)) workloadType = "docs_qa";
  if (/refund|shipping|faq|support/.test(text)) workloadType = "support_faq";
  if (/modify|edit|patch|write file|apply diff|refactor/.test(text)) workloadType = "code_modification";
  else if (/explain.*code|what does.*function|read.*code/.test(text)) workloadType = "code_explanation";
  else if (/generate.*code|write.*function|implement/.test(text)) workloadType = "code_generation";
  if (/plan|next step|tool call|agent/.test(text)) workloadType = "agent_planning";
  if (/extract|parse|json/.test(text)) workloadType = "extraction";
  if (/classify|label|categorize/.test(text)) workloadType = "classification";
  if (/embed|embedding|vector search/.test(text)) workloadType = "embedding_search";
  if (/payment|wire|legal|medical|security|delete production|private key|secret/.test(text)) workloadType = "high_risk_action";

  const riskLevel: RiskLevel =
    workloadType === "high_risk_action" || /private key|secret|credential|payment|wire|delete production/.test(text)
      ? "high"
      : workloadType === "code_modification" || workloadType === "agent_planning"
        ? "medium"
        : "low";
  const tokenish = text.length / 4 + JSON.stringify(request.tools).length / 4;
  const complexity = tokenish > 8000 || request.tools.length > 5 ? "high" : tokenish > 1500 || request.tools.length > 0 ? "medium" : "low";
  const cacheability = riskLevel === "high" ? "never" : ["docs_qa", "support_faq", "summarization", "classification"].includes(workloadType) ? "safe" : "risky";
  const recommendedPath = cacheability === "safe" ? "semantic_cache_first" : riskLevel === "high" ? "strong_model_with_verifier" : "exact_cache_then_route";
  return { workloadType, riskLevel, cacheability, complexity, recommendedPath };
}
