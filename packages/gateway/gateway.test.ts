import { describe, expect, it } from "vitest";
import { normalizeOpenAIChatRequest, normalizeOpenAIResponsesRequest, toOpenAIChatCompletion, toOpenAIChatCompletionStream, toOpenAIResponse } from "./src/index.js";

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

  it("normalizes OpenAI responses requests into chat requests", () => {
    const req = normalizeOpenAIResponsesRequest({
      model: "gpt-5-mini",
      input: "Explain TokenOps cache policy.",
      metadata: { agent_id: "agent_1" },
    });
    expect(req.requested_model).toBe("gpt-5-mini");
    expect(req.messages[0]!.role).toBe("user");
    expect(req.messages[0]!.content).toBe("Explain TokenOps cache policy.");
    expect(req.agent_id).toBe("agent_1");
  });

  it("returns OpenAI-compatible responses shape", () => {
    const req = normalizeOpenAIResponsesRequest({ model: "mock", input: "hello" });
    const out = toOpenAIResponse(req, {
      id: "resp_model",
      model: "mock",
      provider: "mock",
      content: "hi",
      finish_reason: "stop",
      input_tokens: 10,
      output_tokens: 2,
      latency_ms: 1,
      cost_usd: 0,
    }, "resp_test");
    expect(out.object).toBe("response");
    expect(out.id).toBe("resp_test");
    expect(out.output_text).toBe("hi");
    expect(out.output[0]!.content[0]!.text).toBe("hi");
    expect(out.usage.total_tokens).toBe(12);
  });
});
