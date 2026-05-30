import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenOpsClient } from "./src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("TokenOpsClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TOKENOPS_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  it("posts chat completions to the OpenAI-compatible gateway with idempotency", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: "chatcmpl_sdk",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }),
    );
    const client = new TokenOpsClient({ base_url: "http://localhost:8787/v1", token: "tok", fetch: fetcher });

    const response = await client.chatCompletions(
      { model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] },
      { idempotencyKey: "idem-sdk-1" },
    );

    expect(response.id).toBe("chatcmpl_sdk");
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8787/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tok",
          "content-type": "application/json",
          "idempotency-key": "idem-sdk-1",
        }),
        body: JSON.stringify({ model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] }),
      }),
    );
  });

  it("returns raw SSE text for streaming chat completions", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const fetcher = vi.fn(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const client = new TokenOpsClient({ base_url: "http://localhost:8787", fetch: fetcher });

    const response = await client.chatCompletionsStream({
      model: "mock",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response).toBe(sse);
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8787/v1/chat/completions",
      expect.objectContaining({ body: expect.stringContaining('"stream":true') }),
    );
  });

  it("uses TokenOps root endpoints for stats, cache, budget, traces, and policy simulation", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === "/stats") return jsonResponse({ requests: 3 });
      if (path === "/cache/stats") return jsonResponse({ exact: { hits: 1 } });
      if (path === "/budget/status") return jsonResponse({ policy: { daily_budget_usd: 1 } });
      if (path === "/traces") return jsonResponse({ traces: [{ id: "trace_1" }] });
      if (path === "/policy/simulate") return jsonResponse({ totalTraces: 1, blocked: 0 });
      return jsonResponse({ error: "unexpected" }, { status: 404 });
    });
    const client = new TokenOpsClient({ base_url: "http://localhost:8787/v1", fetch: fetcher });

    await expect(client.stats()).resolves.toEqual({ requests: 3 });
    await expect(client.cacheStats()).resolves.toEqual({ exact: { hits: 1 } });
    await expect(client.budgetStatus()).resolves.toEqual({ policy: { daily_budget_usd: 1 } });
    await expect(client.traces({ limit: 1 })).resolves.toEqual({ traces: [{ id: "trace_1" }] });
    await expect(client.policySimulate({ daily_budget_usd: 1 })).resolves.toEqual({ totalTraces: 1, blocked: 0 });

    expect(fetcher).toHaveBeenCalledWith("http://localhost:8787/traces?limit=1", expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8787/policy/simulate",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ policy: { daily_budget_usd: 1 } }) }),
    );
  });
});
