export type Role = "system" | "developer" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<Record<string, unknown>>;
}

export type WorkloadType =
  | "chat"
  | "summarization"
  | "docs_qa"
  | "support_faq"
  | "code_generation"
  | "code_explanation"
  | "code_modification"
  | "agent_planning"
  | "agent_tool_reasoning"
  | "verification"
  | "extraction"
  | "classification"
  | "embedding_search"
  | "high_risk_action"
  | "unknown";

export type RiskLevel = "low" | "medium" | "high";
export type Complexity = "low" | "medium" | "high";
export type Cacheability =
  | "exact_safe"
  | "semantic_safe"
  | "tool_safe"
  | "context_safe"
  | "private_or_risky"
  | "never_cache";

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<Record<string, unknown>>;
  temperature?: number;
  response_format?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  user?: string;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface NormalizedRequest {
  id: string;
  provider: string;
  requested_model: string;
  messages: ChatMessage[];
  tools: Array<Record<string, unknown>>;
  temperature: number;
  response_format: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  user_id?: string;
  agent_id?: string;
  workload_type: WorkloadType;
  risk_level: RiskLevel;
  normalized_hash: string;
  created_at: string;
  max_output_tokens?: number;
}

export interface ModelResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  finish_reason: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_usd: number;
  raw?: unknown;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export type ForegroundAction =
  | "serve_exact_cache"
  | "serve_semantic_cache"
  | "call_model"
  | "return_partial"
  | "block_budget"
  | "ask_clarification";

export type BackgroundTask =
  | "verify_cached_answer"
  | "precompute_context"
  | "compress_trace"
  | "refresh_tool_cache"
  | "generate_better_answer"
  | "evaluate_quality"
  | "summarize_trace"
  | "prepare_fallback";

export interface ComputePlan {
  requestId: string;
  foregroundAction: ForegroundAction;
  backgroundTasks: BackgroundTask[];
  modelRoute: {
    primary: string;
    fallback?: string;
    verifier?: string;
  };
  cacheStrategy: {
    exact: boolean;
    semantic: boolean;
    toolResult: boolean;
    contextBlock: boolean;
    prefixSimulation: boolean;
  };
  contextStrategy: {
    dedupeRepeatedContext: boolean;
    prefixCacheEligibleTokens: number;
  };
  expected: {
    latencyMs: number;
    costUsd: number;
    risk: RiskLevel;
  };
  reason: string;
}

export type CacheEntryType = "exact" | "semantic" | "tool_result" | "context_block" | "prefix_simulation";

export interface CacheEntry<T = unknown> {
  key: string;
  type: CacheEntryType;
  request_hash: string;
  response: T;
  metadata: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
  hit_count: number;
  safety_class: Cacheability;
}

export interface BudgetPolicy {
  policy_id: string;
  user_id?: string;
  agent_id?: string;
  daily_budget_usd: number;
  max_request_cost_usd: number;
  max_model: string;
  allow_expensive_models: boolean;
  block_on_budget_exceeded: boolean;
  warn_threshold: number;
}

export interface RequestTrace {
  id: string;
  timestamp: string;
  workloadType: WorkloadType;
  userId?: string;
  agentId?: string;
  requestedModel: string;
  selectedModel: string;
  selectedProvider: string;
  inputTokensEstimated: number;
  outputTokensEstimated?: number;
  providerLatencyMs?: number;
  cache: {
    exactHit: boolean;
    semanticHit: boolean;
    toolResultHit: boolean;
    contextBlockHit: boolean;
    prefixCacheEligibleTokens: number;
  };
  routing: {
    selectedProvider: string;
    selectedModel: string;
    originalRequestedModel?: string;
    downgraded: boolean;
    escalated: boolean;
    reason: string;
  };
  policy: {
    allowed: boolean;
    reason: string;
    budgetRemaining?: number;
  };
  cost: {
    estimatedBaselineCost: number;
    estimatedOptimizedCost: number;
    estimatedSavings: number;
  };
  quality?: {
    verifierUsed: boolean;
    verifierPassed?: boolean;
    escalatedAfterFail?: boolean;
  };
  computePlanId?: string;
  normalizedHash: string;
  finalResponseSource: "exact_cache" | "semantic_cache" | "model" | "blocked" | "provider_error";
}

export interface BenchmarkResult {
  dataset: string;
  total_requests: number;
  baseline_cost: number;
  optimized_cost: number;
  estimated_savings: number;
  exact_cache_hit_rate: number;
  semantic_cache_hit_rate: number;
  tool_result_reuse_rate: number;
  model_downgrade_rate: number;
  verifier_escalation_rate: number;
  p50_latency_estimate: number;
  p95_latency_estimate: number;
  wrong_cache_incidents: number;
  baseline_model_calls?: number;
  optimized_model_calls?: number;
  context_block_reuse_rate?: number;
  estimated_input_tokens_saved?: number;
  estimated_output_tokens_saved?: number;
  prefix_cache_eligible_tokens?: number;
  quality_warnings?: string[];
}
