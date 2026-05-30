import type { ChatMessage, NormalizedRequest } from "./types.js";

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function messageToText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  if (message.content == null) return "";
  return JSON.stringify(message.content);
}

export function estimateMessageTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + 4 + estimateTextTokens(messageToText(message)), 0);
}

export function estimateToolTokens(tools: Array<Record<string, unknown>>): number {
  return tools.length === 0 ? 0 : estimateTextTokens(JSON.stringify(tools));
}

export function estimateInputTokens(request: Pick<NormalizedRequest, "messages" | "tools">): number {
  return estimateMessageTokens(request.messages) + estimateToolTokens(request.tools);
}
