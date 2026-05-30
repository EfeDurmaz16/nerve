import { z } from "zod";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import type { ChatMessage, NormalizedRequest, OpenAIChatCompletionRequest } from "@tokenops/core";

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

const ResponsesInputMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]),
}).passthrough();

export const OpenAIResponsesRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(ResponsesInputMessageSchema)]),
  tools: z.array(z.record(z.unknown())).optional(),
  temperature: z.number().min(0).max(2).optional(),
  text: z.object({ format: z.record(z.unknown()).optional() }).optional(),
  response_format: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  user: z.string().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
}).passthrough();

export function responsesRequestToChatRequest(body: unknown): OpenAIChatCompletionRequest {
  const parsed = OpenAIResponsesRequestSchema.safeParse(body);
  if (!parsed.success) throw new Error(`invalid OpenAI responses request: ${parsed.error.message}`);
  const input = parsed.data.input;
  const messages: ChatMessage[] = typeof input === "string"
    ? [{ role: "user", content: input }]
    : input.map((message) => ({ ...message }));
  return {
    model: parsed.data.model,
    messages,
    tools: parsed.data.tools,
    temperature: parsed.data.temperature,
    response_format: parsed.data.response_format ?? parsed.data.text?.format,
    metadata: parsed.data.metadata,
    user: parsed.data.user,
    max_completion_tokens: parsed.data.max_output_tokens,
    stream: parsed.data.stream,
  };
}

export function normalizeOpenAIResponsesRequest(body: unknown): NormalizedRequest {
  return normalizeChatCompletionRequest(responsesRequestToChatRequest(body));
}
