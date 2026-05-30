import { ulid } from "ulid";
import { hashJson } from "./hashing.js";
import type { NormalizedRequest, OpenAIChatCompletionRequest, RiskLevel, WorkloadType } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeChatCompletionRequest(
  request: OpenAIChatCompletionRequest,
  opts: { provider?: string; workloadType?: WorkloadType; riskLevel?: RiskLevel } = {},
): NormalizedRequest {
  const metadata = { ...(request.metadata ?? {}) };
  const agentId =
    typeof metadata.agent_id === "string"
      ? metadata.agent_id
      : typeof metadata.agentId === "string"
        ? metadata.agentId
        : undefined;
  const maxOutput = request.max_completion_tokens ?? request.max_tokens;
  const base = {
    provider: opts.provider ?? "mock",
    requested_model: request.model,
    messages: request.messages,
    tools: request.tools ?? [],
    temperature: request.temperature ?? 0,
    response_format: request.response_format ?? null,
    metadata,
    user_id: request.user,
    agent_id: agentId,
    workload_type: opts.workloadType ?? "unknown",
    risk_level: opts.riskLevel ?? "low",
    max_output_tokens: typeof maxOutput === "number" ? maxOutput : undefined,
  };
  const normalized_hash = stableRequestHash(base);
  return {
    id: `req_${ulid()}`,
    ...base,
    normalized_hash,
    created_at: nowIso(),
  };
}

export function stableRequestHash(input: {
  provider: string;
  requested_model: string;
  messages: unknown;
  tools: unknown;
  temperature: number;
  response_format: unknown;
  metadata: Record<string, unknown>;
  user_id?: string;
  agent_id?: string;
}): string {
  const relevantMetadata = Object.fromEntries(
    Object.entries(input.metadata).filter(([key]) => ![
      "request_id",
      "trace_id",
      "timestamp",
      "created_at",
      "tokenops_priority",
      "tokenopsPriority",
      "priority",
    ].includes(key)),
  );
  return hashJson({
    provider: input.provider,
    requested_model: input.requested_model,
    messages: input.messages,
    tools: input.tools,
    temperature: input.temperature,
    response_format: input.response_format,
    metadata: relevantMetadata,
    user_id: input.user_id ?? null,
    agent_id: input.agent_id ?? null,
  });
}
