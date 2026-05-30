import { z } from "zod";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import type { NormalizedRequest, OpenAIChatCompletionRequest } from "@tokenops/core";

const ChatMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]),
}).passthrough();

export const OpenAIChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  tools: z.array(z.record(z.unknown())).optional(),
  temperature: z.number().min(0).max(2).optional(),
  response_format: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  user: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
}).passthrough();

export function normalizeOpenAIChatRequest(body: unknown): NormalizedRequest {
  const parsed = OpenAIChatCompletionRequestSchema.safeParse(body);
  if (!parsed.success) throw new Error(`invalid OpenAI chat completion request: ${parsed.error.message}`);
  return normalizeChatCompletionRequest(parsed.data as OpenAIChatCompletionRequest);
}
