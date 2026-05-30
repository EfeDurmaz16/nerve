import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDb } from "@nerve/store";
import { createApp } from "../apps/server/src/index.js";

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

loadDotEnv(resolve(process.cwd(), ".env"));

const GROQ_BASE_URL = (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const PROMPT = "Reply with exactly: TokenOps comparison live";
const REPORT_PATH = "docs/experiments/groq-live-comparison-report.json";
const MARKDOWN_PATH = "docs/experiments/groq-live-comparison.md";

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing from environment or .env");

  console.log("Hypothesis:");
  console.log("- Direct Groq: identical prompt twice means 2 provider calls.");
  console.log("- TokenOps: identical prompt twice means first call hits Groq, second call hits exact cache.");
  console.log("- Expected quality: same answer shape; expected compute: fewer provider calls through TokenOps.\n");

  const direct1 = await directGroq();
  const direct2 = await directGroq();

  const dbPath = "/tmp/tokenops-live-comparison.db";
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const oldProvider = process.env.TOKENOPS_PROVIDER;
  process.env.TOKENOPS_PROVIDER = "groq";
  const app = createApp({ db: openDb(dbPath), dbPath });
  const gateway1 = await gatewayCall(app);
  const gateway2 = await gatewayCall(app);
  const stats = (await app.inject({ method: "GET", url: "/stats" })).json();
  const cacheStats = (await app.inject({ method: "GET", url: "/cache/stats" })).json();
  await app.close();
  if (oldProvider === undefined) delete process.env.TOKENOPS_PROVIDER;
  else process.env.TOKENOPS_PROVIDER = oldProvider;

  const result = {
    generatedAt: new Date().toISOString(),
    hypothesis: {
      directGroq: "Two identical direct requests make two provider calls.",
      tokenops: "Two identical gateway requests make one provider call and one exact-cache hit.",
    },
    model: MODEL,
    direct: {
      providerCalls: 2,
      ids: [direct1.id, direct2.id],
      contents: [contentOf(direct1), contentOf(direct2)],
      totalTokens: (direct1.usage?.total_tokens ?? 0) + (direct2.usage?.total_tokens ?? 0),
    },
    tokenops: {
      providerCallsObserved: [gateway1.tokenops?.cache.exactHit, gateway2.tokenops?.cache.exactHit].filter((hit) => !hit).length,
      traceIds: [gateway1.tokenops?.trace_id, gateway2.tokenops?.trace_id],
      exactHits: [gateway1.tokenops?.cache.exactHit, gateway2.tokenops?.cache.exactHit],
      contents: [contentOf(gateway1), contentOf(gateway2)],
      stats,
      cacheStats,
    },
    assertions: {
      directMadeTwoCalls: true,
      tokenopsObservedOneProviderCall: [gateway1.tokenops?.cache.exactHit, gateway2.tokenops?.cache.exactHit].filter((hit) => !hit).length === 1,
      secondGatewayCallExactHit: gateway2.tokenops?.cache.exactHit === true,
      contentMatches: contentOf(gateway1) === contentOf(gateway2),
    },
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(MARKDOWN_PATH, formatMarkdown(result));
  console.log(JSON.stringify(result, null, 2));
  if (!Object.values(result.assertions).every(Boolean)) process.exit(1);
}

async function directGroq(): Promise<ChatResponse> {
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
      temperature: 0,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`direct Groq failed ${res.status}: ${redact(text)}`);
  return JSON.parse(text) as ChatResponse;
}

async function gatewayCall(app: Awaited<ReturnType<typeof createApp>>): Promise<ChatResponse> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
      temperature: 0,
    },
  });
  if (res.statusCode !== 200) throw new Error(`TokenOps failed ${res.statusCode}: ${redact(res.body)}`);
  return res.json() as ChatResponse;
}

function contentOf(response: ChatResponse): string {
  return response.choices[0]?.message.content ?? "";
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

function formatMarkdown(result: {
  generatedAt: string;
  model: string;
  direct: { providerCalls: number; totalTokens: number; contents: string[] };
  tokenops: { providerCallsObserved: number; exactHits: Array<boolean | undefined>; contents: string[] };
  assertions: Record<string, boolean>;
}): string {
  return [
    "# Groq Live Comparison",
    "",
    `Generated: ${result.generatedAt}`,
    `Model: ${result.model}`,
    "",
    "## Hypothesis",
    "",
    "- Direct Groq repeats burn provider compute twice.",
    "- TokenOps serves the second identical request from exact cache.",
    "",
    "## Result",
    "",
    `- Direct provider calls: ${result.direct.providerCalls}`,
    `- Direct total tokens: ${result.direct.totalTokens}`,
    `- TokenOps provider calls observed: ${result.tokenops.providerCallsObserved}`,
    `- TokenOps exact hits: ${result.tokenops.exactHits.join(", ")}`,
    `- Content matches: ${result.assertions.contentMatches}`,
    "",
    "## Assertions",
    "",
    ...Object.entries(result.assertions).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ].join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
