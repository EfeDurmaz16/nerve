import type { ModelResponse, NormalizedRequest } from "@tokenops/core";

export function toOpenAIChatCompletion(request: NormalizedRequest, response: ModelResponse) {
  const created = Math.floor(Date.now() / 1000);
  return {
    id: response.id,
    object: "chat.completion",
    created,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.content,
        },
        finish_reason: response.finish_reason,
      },
    ],
    usage: {
      prompt_tokens: response.input_tokens,
      completion_tokens: response.output_tokens,
      total_tokens: response.input_tokens + response.output_tokens,
    },
    tokenops: {
      request_id: request.id,
      provider: response.provider,
      normalized_hash: request.normalized_hash,
      cost_usd: response.cost_usd,
      latency_ms: response.latency_ms,
    },
  };
}

export function toOpenAIChatCompletionStream(response: ModelResponse): string {
  const created = Math.floor(Date.now() / 1000);
  const chunk = {
    id: response.id,
    object: "chat.completion.chunk",
    created,
    model: response.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: response.content },
        finish_reason: null,
      },
    ],
  };
  const done = {
    id: response.id,
    object: "chat.completion.chunk",
    created,
    model: response.model,
    choices: [{ index: 0, delta: {}, finish_reason: response.finish_reason }],
  };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`;
}

export function toOpenAIResponse(request: NormalizedRequest, response: ModelResponse, id = `resp_${response.id}`) {
  const created = Math.floor(Date.now() / 1000);
  return {
    id,
    object: "response",
    created_at: created,
    status: response.finish_reason === "stop" ? "completed" : "incomplete",
    model: response.model,
    output: [
      {
        id: `msg_${response.id}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: response.content,
          },
        ],
      },
    ],
    output_text: response.content,
    usage: {
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      total_tokens: response.input_tokens + response.output_tokens,
    },
    tokenops: {
      request_id: request.id,
      provider: response.provider,
      normalized_hash: request.normalized_hash,
      cost_usd: response.cost_usd,
      latency_ms: response.latency_ms,
    },
  };
}
