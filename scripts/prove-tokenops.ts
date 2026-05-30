import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDb } from "@nerve/store";
import { createApp } from "../apps/server/src/index.js";
import { classifyCacheability } from "@tokenops/profiler";
import { normalizeChatCompletionRequest } from "@tokenops/core";

type ChatResponse = {
  id: string;
  model: string;
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  tokenops?: {
    provider: string;
    cache: { exactHit: boolean; semanticHit: boolean };
    trace_id: string;
    cost_usd: number;
    latency_ms: number;
  };
};

const REPORT_PATH = "docs/experiments/tokenops-proof-report.json";
const GROQ_BASE_URL = (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const PROMPT = "Reply with exactly: TokenOps proof live";

loadDotEnv(resolve(process.cwd(), ".env"));

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing from environment or .env");

  const direct1 = await directGroq(PROMPT);
  const direct2 = await directGroq(PROMPT);

  const dbPath = "/tmp/tokenops-proof.db";
  cleanDb(dbPath);

  const oldProvider = process.env.TOKENOPS_PROVIDER;
  process.env.TOKENOPS_PROVIDER = "groq";
  const app1 = createApp({ db: openDb(dbPath), dbPath });
  const tokenops1 = await gatewayCall(app1, PROMPT);
  const tokenops2 = await gatewayCall(app1, PROMPT);
  const budgetBlock = await budgetBlockCall(app1);
  const app1Stats = (await app1.inject({ method: "GET", url: "/stats" })).json();
  const app1Cache = (await app1.inject({ method: "GET", url: "/cache/stats" })).json();
  await app1.close();

  const app2 = createApp({ db: openDb(dbPath), dbPath });
  const afterRestart = await gatewayCall(app2, PROMPT);
  const app2Stats = (await app2.inject({ method: "GET", url: "/stats" })).json();
  await app2.close();
  restoreProvider(oldProvider);

  const risky = normalizeChatCompletionRequest({
    model: MODEL,
    messages: [{ role: "user", content: "Use this private secret token to wire a payment." }],
  });

  const proof = {
    hypothesis: {
      directGroq: "Two identical direct requests produce two provider calls.",
      tokenops: "Two identical TokenOps requests produce one provider call and one exact-cache hit.",
      persistence: "SQLite exact cache survives app restart.",
      budget: "Over-budget requests are blocked before provider execution.",
      safety: "Risky/private payment prompts are not semantic-cache eligible.",
    },
    model: MODEL,
    directGroq: {
      providerCalls: 2,
      responseIds: [direct1.id, direct2.id],
      contents: [contentOf(direct1), contentOf(direct2)],
      totalTokens: (direct1.usage?.total_tokens ?? 0) + (direct2.usage?.total_tokens ?? 0),
    },
    tokenops: {
      firstCall: summarizeGateway(tokenops1),
      secondCall: summarizeGateway(tokenops2),
      providerCallsObserved: [tokenops1, tokenops2].filter((r) => !r.tokenops?.cache.exactHit).length,
      appStats: app1Stats,
      cacheStats: app1Cache,
    },
    restartPersistence: {
      afterRestart: summarizeGateway(afterRestart),
      appStats: app2Stats,
    },
    budgetBlock: {
      statusCode: budgetBlock.statusCode,
      body: budgetBlock.body,
    },
    safety: {
      riskyPromptCacheability: classifyCacheability({ ...risky, provider: "groq", risk_level: "high" }),
    },
    assertions: {
      directMadeTwoCalls: direct1.id !== direct2.id,
      tokenopsSecondCallExactHit: tokenops2.tokenops?.cache.exactHit === true,
      tokenopsObservedOneProviderCall: [tokenops1, tokenops2].filter((r) => !r.tokenops?.cache.exactHit).length === 1,
      restartExactHit: afterRestart.tokenops?.cache.exactHit === true,
      budgetBlocked: budgetBlock.statusCode === 402,
      riskyPromptNotSemanticSafe: classifyCacheability({ ...risky, provider: "groq", risk_level: "high" }) === "never_cache",
      contentMatches: contentOf(tokenops1) === contentOf(tokenops2) && contentOf(tokenops2) === contentOf(afterRestart),
    },
  };

  const allPassed = Object.values(proof.assertions).every(Boolean);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ allPassed, reportPath: REPORT_PATH, proof }, null, 2));
  if (!allPassed) process.exit(1);
}

async function directGroq(prompt: string): Promise<ChatResponse> {
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`direct Groq failed ${res.status}: ${redact(text)}`);
  return JSON.parse(text) as ChatResponse;
}

async function gatewayCall(app: Awaited<ReturnType<typeof createApp>>, prompt: string): Promise<ChatResponse> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0 },
  });
  if (res.statusCode !== 200) throw new Error(`TokenOps failed ${res.statusCode}: ${redact(res.body)}`);
  return res.json() as ChatResponse;
}

async function budgetBlockCall(app: Awaited<ReturnType<typeof createApp>>): Promise<{ statusCode: number; body: unknown }> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {
      model: MODEL,
      max_completion_tokens: 1_000_000,
      messages: [{ role: "user", content: "This should be blocked by budget before provider execution." }],
    },
  });
  return { statusCode: res.statusCode, body: res.json() };
}

function summarizeGateway(response: ChatResponse) {
  return {
    id: response.id,
    provider: response.tokenops?.provider,
    model: response.model,
    exactHit: response.tokenops?.cache.exactHit,
    semanticHit: response.tokenops?.cache.semanticHit,
    content: contentOf(response),
    costUsd: response.tokenops?.cost_usd,
    latencyMs: response.tokenops?.latency_ms,
  };
}

function contentOf(response: ChatResponse): string {
  return response.choices[0]?.message.content ?? "";
}

function cleanDb(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

function restoreProvider(oldProvider: string | undefined): void {
  if (oldProvider === undefined) delete process.env.TOKENOPS_PROVIDER;
  else process.env.TOKENOPS_PROVIDER = oldProvider;
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function redact(text: string): string {
  return text.replace(/gsk_[A-Za-z0-9_\-]+/g, "gsk_[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
