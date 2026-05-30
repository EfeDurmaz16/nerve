import { describe, expect, it } from "vitest";
import { createApp } from "./src/index.js";
import { openDb } from "@nerve/store";
import { rmSync } from "node:fs";
import type { RequestTrace } from "@tokenops/core";

async function withProvider<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const old = process.env.TOKENOPS_PROVIDER;
  process.env.TOKENOPS_PROVIDER = provider;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.TOKENOPS_PROVIDER;
    else process.env.TOKENOPS_PROVIDER = old;
  }
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) old[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("TokenOps server", () => {
  it("serves OpenAI-compatible chat completions", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "gpt-5.5", messages: [{ role: "user", content: "docs quickstart" }] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe("chat.completion");
      expect(body.choices[0].message.role).toBe("assistant");
      expect(res.headers["x-tokenops-trace-id"]).toBeTruthy();
      const trace = (await app.inject({ method: "GET", url: `/traces/${res.headers["x-tokenops-trace-id"]}` })).json();
      expect(trace.providerLatencyMs).toBeGreaterThanOrEqual(1);
      await app.close();
    });
  });

  it("exposes stats and traces", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { model: "mock", messages: [{ role: "user", content: "hello" }] } });
      expect((await app.inject({ method: "GET", url: "/stats" })).json().requests).toBe(1);
      expect((await app.inject({ method: "GET", url: "/stats" })).json().provider_health.providers.mock.requests).toBe(1);
      expect((await app.inject({ method: "GET", url: "/providers/health" })).json().providers.mock.requests).toBe(1);
      expect((await app.inject({ method: "GET", url: "/traces" })).json().traces.length).toBe(1);
      await app.close();
    });
  });

  it("runs replay through the local HTTP API and stores benchmark results", async () => {
    const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
    const replay = await app.inject({
      method: "POST",
      url: "/replay",
      payload: { dataset: "benchmark/datasets/docs-qa.jsonl" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().results[0].dataset).toBe("docs-qa.jsonl");
    const results = await app.inject({ method: "GET", url: "/benchmark/results" });
    expect(results.json().results.length).toBe(1);
    await app.close();
  });

  it("supports OpenAI-compatible streaming chunks", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "mock", stream: true, messages: [{ role: "user", content: "hello" }] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.body).toContain("data: [DONE]");
      await app.close();
    });
  });

  it("serves minimal OpenAI-compatible responses", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const res = await app.inject({
        method: "POST",
        url: "/v1/responses",
        payload: { model: "gpt-5-mini", input: "Explain TokenOps response compatibility.", metadata: { agent_id: "agent_responses" } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe("response");
      expect(body.output_text).toContain("Mock TokenOps response");
      expect(body.output[0].type).toBe("message");
      expect(body.usage.total_tokens).toBeGreaterThan(0);
      expect(body.tokenops.trace_id).toBeTruthy();
      const trace = (await app.inject({ method: "GET", url: `/traces/${body.tokenops.trace_id}` })).json();
      expect(trace.agentId).toBe("agent_responses");
      await app.close();
    });
  });

  it("serves deterministic OpenAI-compatible embeddings", async () => {
    const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
    const payload = {
      model: "text-embedding-3-small",
      input: ["TokenOps cache policy", "Adaptive inference control plane"],
      dimensions: 32,
    };
    const first = await app.inject({ method: "POST", url: "/v1/embeddings", payload });
    const second = await app.inject({ method: "POST", url: "/v1/embeddings", payload });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(2);
    expect(body.data[0].object).toBe("embedding");
    expect(body.data[0].embedding).toHaveLength(32);
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.tokenops.provider).toBe("local");
    expect(body.tokenops.deterministic).toBe(true);
    expect(second.json().data[0].embedding).toEqual(body.data[0].embedding);
    await app.close();
  });

  it("replays successful chat completions by idempotency key without creating a second trace", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "mock", messages: [{ role: "user", content: "retry-safe model call" }] };
      const first = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "idempotency-key": "idem-chat-1" },
        payload,
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "idempotency-key": "idem-chat-1" },
        payload,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.headers["x-tokenops-idempotency-hit"]).toBe("true");
      expect(second.headers["x-tokenops-trace-id"]).toBe(first.headers["x-tokenops-trace-id"]);
      expect(second.json()).toEqual(first.json());
      expect((await app.inject({ method: "GET", url: "/stats" })).json().requests).toBe(1);
      await app.close();
    });
  });

  it("rejects reused idempotency keys for different chat requests", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const first = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "idempotency-key": "idem-conflict-1" },
        payload: { model: "mock", messages: [{ role: "user", content: "first request" }] },
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "idempotency-key": "idem-conflict-1" },
        payload: { model: "mock", messages: [{ role: "user", content: "different request" }] },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.type).toBe("idempotency_key_conflict");
      expect((await app.inject({ method: "GET", url: "/stats" })).json().requests).toBe(1);
      await app.close();
    });
  });

  it("persists idempotency records across app instances", async () => {
    await withProvider("mock", async () => {
      const dbPath = "/tmp/tokenops-server-idempotency-test.db";
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      const payload = { model: "mock", messages: [{ role: "user", content: "persisted retry-safe model call" }] };
      const firstApp = createApp({ db: openDb(dbPath), dbPath });
      const first = await firstApp.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "idempotency-key": "idem-persist-1" },
        payload,
      });
      await firstApp.close();

      const secondApp = createApp({ db: openDb(dbPath), dbPath });
      const second = await secondApp.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "idempotency-key": "idem-persist-1" },
        payload,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.headers["x-tokenops-idempotency-hit"]).toBe("true");
      expect(second.headers["x-tokenops-trace-id"]).toBe(first.headers["x-tokenops-trace-id"]);
      expect(second.json()).toEqual(first.json());
      expect((await secondApp.inject({ method: "GET", url: "/stats" })).json().requests).toBe(1);
      await secondApp.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    });
  });

  it("returns a clear provider error when Groq key is missing", async () => {
    const old = process.env.TOKENOPS_PROVIDER;
    const oldGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.TOKENOPS_PROVIDER = "groq";
    const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hello" }] },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toContain("GROQ_API_KEY is not set");
    expect(res.headers["x-tokenops-trace-id"]).toBeTruthy();
    const traces = (await app.inject({ method: "GET", url: "/traces" })).json().traces;
    expect(traces[0].finalResponseSource).toBe("provider_error");
    expect(traces[0].policy.allowed).toBe(false);
    if (old === undefined) delete process.env.TOKENOPS_PROVIDER;
    else process.env.TOKENOPS_PROVIDER = old;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldGroqKey;
    await app.close();
  });

  it("separates exact cache by selected provider", async () => {
    const oldGroqKey = process.env.GROQ_API_KEY;
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "same prompt" }] };
      const mock = await app.inject({ method: "POST", url: "/v1/chat/completions", payload });
      expect(mock.json().tokenops.provider).toBe("mock");
      process.env.TOKENOPS_PROVIDER = "groq";
      delete process.env.GROQ_API_KEY;
      const groq = await app.inject({ method: "POST", url: "/v1/chat/completions", payload });
      expect(groq.statusCode).toBe(502);
      expect(groq.json().error.message).toContain("GROQ_API_KEY is not set");
      await app.close();
    });
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldGroqKey;
  });

  it("falls back across provider chain at runtime", async () => {
    const old = process.env.TOKENOPS_PROVIDER;
    const oldGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.TOKENOPS_PROVIDER = "groq,mock";
    const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-5-mini", messages: [{ role: "user", content: "fallback docs quickstart" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokenops.provider).toBe("mock");
    expect(body.tokenops.routing.selectedProvider).toBe("mock");
    expect(body.tokenops.routing.reason).toContain("fallback");
    if (old === undefined) delete process.env.TOKENOPS_PROVIDER;
    else process.env.TOKENOPS_PROVIDER = old;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldGroqKey;
    await app.close();
  });

  it("records provider attempts for fallback chains", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "groq,mock", GROQ_API_KEY: undefined }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "gpt-5-mini", messages: [{ role: "user", content: "attempt ledger fallback" }] },
      });
      expect(res.statusCode).toBe(200);
      const attempts = (await app.inject({ method: "GET", url: "/providers/attempts" })).json().attempts;
      expect(attempts.map((attempt: { provider: string }) => attempt.provider)).toEqual(["mock", "groq"]);
      expect(attempts.find((attempt: { provider: string }) => attempt.provider === "groq")).toMatchObject({ ok: false });
      expect(attempts.find((attempt: { provider: string }) => attempt.provider === "mock")).toMatchObject({ ok: true });
      await app.close();
    });
  });

  it("exposes and applies learned routing policy when enabled", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "mock", TOKENOPS_ADAPTIVE_ROUTING: "1", TOKENOPS_ROUTING_MIN_SAMPLES: "2" }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "gpt-5.5", messages: [{ role: "user", content: "docs quickstart adaptive routing" }] };
      await app.inject({ method: "POST", url: "/v1/chat/completions", payload });
      await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { ...payload, messages: [{ role: "user", content: "docs quickstart adaptive routing again" }] } });
      const policy = await app.inject({ method: "GET", url: "/routing/policy" });
      expect(policy.statusCode).toBe(200);
      expect(policy.json().rules.length).toBeGreaterThan(0);
      const routed = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "gpt-5.5", messages: [{ role: "user", content: "docs quickstart learned route new prompt" }] },
      });
      expect(routed.json().tokenops.routing.reason).toContain("learned routing policy");
      await app.close();
    });
  });

  it("persists semantic and context caches across app instances", async () => {
    await withProvider("mock", async () => {
      const dbPath = "/tmp/tokenops-server-persistent-cache-test.db";
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      const first = createApp({ db: openDb(dbPath), dbPath });
      await first.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gpt-5.5",
          messages: [
            { role: "system", content: "Answer from documentation only." },
            { role: "user", content: "documentation quickstart cache setup install guide" },
          ],
        },
      });
      await first.close();

      const second = createApp({ db: openDb(dbPath), dbPath });
      const res = await second.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gpt-5.5",
          messages: [
            { role: "system", content: "Answer from documentation only." },
            { role: "user", content: "docs quickstart cache setup install guide please" },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tokenops.cache.semanticHit).toBe(true);
      expect(body.tokenops.cache.contextBlockHit).toBe(true);
      const stats = (await second.inject({ method: "GET", url: "/cache/stats" })).json();
      expect(stats.semantic.entries).toBeGreaterThan(0);
      expect(stats.tool.entries).toBe(0);
      expect(stats.context.entries).toBeGreaterThan(0);
      await second.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    });
  });

  it("clears all SQLite cache layers through cache clear", async () => {
    await withProvider("mock", async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const firstPayload = {
        model: "gpt-5.5",
        messages: [
          { role: "system", content: "Answer from documentation only." },
          { role: "user", content: "documentation quickstart cache setup install guide" },
        ],
      };
      await app.inject({ method: "POST", url: "/v1/chat/completions", payload: firstPayload });
      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gpt-5.5",
          messages: [
            { role: "system", content: "Answer from documentation only." },
            { role: "user", content: "docs quickstart cache setup install guide please" },
          ],
        },
      });
      const before = (await app.inject({ method: "GET", url: "/cache/stats" })).json();
      expect(before.exact.entries).toBeGreaterThan(0);
      expect(before.semantic.entries).toBeGreaterThan(0);
      expect(before.context.entries).toBeGreaterThan(0);
      const cleared = await app.inject({ method: "POST", url: "/cache/clear" });
      expect(cleared.statusCode).toBe(200);
      const after = (await app.inject({ method: "GET", url: "/cache/stats" })).json();
      expect(after.exact.entries).toBe(0);
      expect(after.semantic.entries).toBe(0);
      expect(after.context.entries).toBe(0);
      await app.close();
    });
  });

  it("blocks requests above the configured max request cost", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "mock", TOKENOPS_MAX_REQUEST_COST_USD: "0.000001" }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gpt-5.5",
          max_tokens: 512,
          messages: [{ role: "user", content: "Summarize this long enterprise policy document with enough detail to cost money." }],
        },
      });
      expect(res.statusCode).toBe(402);
      expect(res.json().error.type).toBe("budget_policy_block");
      expect(res.json().error.message).toContain("max_request_cost_usd");
      await app.close();
    });
  });

  it("enforces daily user request quota before inference", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "mock", TOKENOPS_MAX_REQUESTS_PER_USER_PER_DAY: "1" }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "mock", user: "quota-user", messages: [{ role: "user", content: "hello quota" }] };
      expect((await app.inject({ method: "POST", url: "/v1/chat/completions", payload })).statusCode).toBe(200);
      const blocked = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { ...payload, messages: [{ role: "user", content: "hello quota again" }] } });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.type).toBe("quota_policy_block");
      await app.close();
    });
  });

  it("enforces per-minute rate limits by user", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "mock", TOKENOPS_RATE_LIMIT_PER_MINUTE: "1" }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "mock", user: "rate-user", messages: [{ role: "user", content: "hello rate" }] };
      expect((await app.inject({ method: "POST", url: "/v1/chat/completions", payload })).statusCode).toBe(200);
      const blocked = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { ...payload, messages: [{ role: "user", content: "hello rate again" }] } });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.type).toBe("rate_limit_exceeded");
      await app.close();
    });
  });

  it("blocks repeated agent loops before another model call", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "mock", TOKENOPS_AGENT_LOOP_MAX_REPEATS: "3" }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = {
        model: "mock",
        metadata: { agent_id: "loop-agent" },
        messages: [{ role: "user", content: "repeat planning step" }],
      };
      expect((await app.inject({ method: "POST", url: "/v1/chat/completions", payload })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/v1/chat/completions", payload })).statusCode).toBe(200);
      const blocked = await app.inject({ method: "POST", url: "/v1/chat/completions", payload });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.type).toBe("agent_loop_block");
      expect(blocked.json().error.message).toContain("repeated");
      await app.close();
    });
  });

  it("coalesces concurrent identical cache misses before provider execution", async () => {
    await withEnv({ TOKENOPS_PROVIDER: "mock", TOKENOPS_MOCK_DELAY_MS: "30" }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "mock", user: "coalesce-user", messages: [{ role: "user", content: "same concurrent prompt" }] };
      const [first, second] = await Promise.all([
        app.inject({ method: "POST", url: "/v1/chat/completions", payload }),
        app.inject({ method: "POST", url: "/v1/chat/completions", payload }),
      ]);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const coalesced = [first.json().tokenops.runtime.coalesced, second.json().tokenops.runtime.coalesced];
      expect(coalesced).toContain(true);
      const stats = (await app.inject({ method: "GET", url: "/runtime/stats" })).json();
      expect(stats.coalescer.sharedCalls).toBe(1);
      expect(stats.coalescer.coalescedWaiters).toBe(1);
      await app.close();
    });
  });

  it("opens a provider circuit after repeated provider failures", async () => {
    const oldGroqKey = process.env.GROQ_API_KEY;
    await withEnv({ TOKENOPS_PROVIDER: "groq", TOKENOPS_CIRCUIT_FAILURE_THRESHOLD: "1", TOKENOPS_CIRCUIT_COOLDOWN_MS: "10000", GROQ_API_KEY: undefined }, async () => {
      const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
      const payload = { model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hello circuit" }] };
      const first = await app.inject({ method: "POST", url: "/v1/chat/completions", payload });
      expect(first.statusCode).toBe(502);
      const second = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { ...payload, messages: [{ role: "user", content: "hello circuit again" }] } });
      expect(second.statusCode).toBe(502);
      expect(second.json().error.message).toContain("circuit open");
      const stats = (await app.inject({ method: "GET", url: "/runtime/stats" })).json();
      expect(stats.circuits.groq.state).toBe("open");
      await app.close();
    });
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldGroqKey;
  });

  it("reroutes with SLO policy when the selected provider violates latency/error windows", async () => {
    await withEnv({
      TOKENOPS_PROVIDER: "groq,mock",
      TOKENOPS_SLO_ROUTING: "1",
      TOKENOPS_SLO_MAX_ERROR_RATE: "0.1",
      TOKENOPS_SLO_MAX_P95_LATENCY_MS: "1000",
      GROQ_API_KEY: undefined,
    }, async () => {
      const db = openDb(":memory:");
      const traces = [
        serverTrace("groq_error", "groq", "provider_error", 20_000),
        serverTrace("groq_slow", "groq", "model", 15_000),
        serverTrace("mock_ok_1", "mock", "model", 30),
        serverTrace("mock_ok_2", "mock", "model", 35),
      ];
      const app = createApp({
        db,
        dbPath: ":memory:",
        state: {
          exactCache: new (await import("@tokenops/cache")).SqliteExactCache(db),
          semanticCache: new (await import("@tokenops/cache")).SqliteSemanticCache(db),
          toolResultCache: new (await import("@tokenops/cache")).SqliteToolResultCache(db),
          contextBlockCache: new (await import("@tokenops/cache")).SqliteContextBlockCache(db),
          traceStore: {
            insert(trace: RequestTrace) { traces.unshift(trace); },
            get(id: string) { return traces.find((trace) => trace.id === id) ?? null; },
            list(limit = 100) { return traces.slice(0, limit); },
            clear() { traces.length = 0; },
          },
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "gpt-5.5", messages: [{ role: "user", content: "hello slo routing" }] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tokenops.routing.selectedProvider).toBe("mock");
      expect(res.json().tokenops.routing.reason).toContain("SLO reroute");
      const slo = (await app.inject({ method: "GET", url: "/routing/slo" })).json();
      expect(slo.providers.groq.eligible).toBe(false);
      expect(slo.providers.mock.eligible).toBe(true);
      await app.close();
    });
  });
});

function serverTrace(id: string, provider: string, source: RequestTrace["finalResponseSource"], latency: number): RequestTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    workloadType: "chat",
    requestedModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    selectedProvider: provider,
    inputTokensEstimated: 10,
    outputTokensEstimated: latency,
    providerLatencyMs: latency,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: provider, selectedModel: "gpt-5.5", originalRequestedModel: "gpt-5.5", downgraded: false, escalated: false, reason: "fixture" },
    policy: { allowed: source !== "provider_error", reason: "fixture" },
    cost: { estimatedBaselineCost: 0.01, estimatedOptimizedCost: provider === "mock" ? 0 : 0.01, estimatedSavings: provider === "mock" ? 0.01 : 0 },
    quality: { verifierUsed: true, verifierPassed: true },
    normalizedHash: id,
    finalResponseSource: source,
  };
}
