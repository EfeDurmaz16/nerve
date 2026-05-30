import { describe, expect, it } from "vitest";
import { normalizeOpenAIChatRequest, toOpenAIChatCompletion, toOpenAIChatCompletionStream } from "./src/index.js";

describe("TokenOps gateway", () => {
  it("normalizes OpenAI chat requests", () => {
    const req = normalizeOpenAIChatRequest({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hello" }],
      user: "u1",
    });
    expect(req.requested_model).toBe("gpt-5.5");
    expect(req.user_id).toBe("u1");
    expect(req.normalized_hash).toHaveLength(64);
  });

  it("returns OpenAI-compatible chat completion shape", () => {
    const req = normalizeOpenAIChatRequest({ model: "mock", messages: [{ role: "user", content: "hello" }] });
    const out = toOpenAIChatCompletion(req, {
      id: "chatcmpl_test",
      model: "mock",
      provider: "mock",
      content: "hi",
      finish_reason: "stop",
      input_tokens: 10,
      output_tokens: 2,
      latency_ms: 1,
      cost_usd: 0,
    });
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0]!.message.content).toBe("hi");
    expect(out.usage.total_tokens).toBe(12);
  });

  it("returns OpenAI-compatible stream chunks", () => {
    const stream = toOpenAIChatCompletionStream({
      id: "chatcmpl_test",
      model: "mock",
      provider: "mock",
      content: "hi",
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    });
    expect(stream).toContain("chat.completion.chunk");
    expect(stream).toContain("data: [DONE]");
  });
});
