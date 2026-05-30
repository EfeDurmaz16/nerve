import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDb } from "@nerve/store";
import { createApp } from "../apps/server/src/index.js";

loadDotEnv(resolve(process.cwd(), ".env"));

const BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const REPORT_PATH = "docs/experiments/ollama-smoke-report.json";

async function main() {
  const available = await ollamaAvailable();
  if (!available) {
    const skipped = {
      generatedAt: new Date().toISOString(),
      skipped: true,
      reason: `Ollama is not reachable at ${BASE_URL}`,
      expectedCommand: "OLLAMA_MODEL=llama3.2 TOKENOPS_CLI=1 npx tsx apps/cli/src/index.ts smoke ollama",
    };
    writeReport(skipped);
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  const oldProvider = process.env.TOKENOPS_PROVIDER;
  process.env.TOKENOPS_PROVIDER = "ollama";
  const app = createApp({ db: openDb(":memory:"), dbPath: ":memory:" });
  const res = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {
      model: "local",
      messages: [{ role: "user", content: "Reply with a short TokenOps Ollama smoke response." }],
      max_tokens: 32,
    },
  });
  const body = res.json();
  await app.close();
  if (oldProvider === undefined) delete process.env.TOKENOPS_PROVIDER;
  else process.env.TOKENOPS_PROVIDER = oldProvider;

  const report = {
    generatedAt: new Date().toISOString(),
    skipped: false,
    statusCode: res.statusCode,
    provider: body.tokenops?.provider,
    model: body.model,
    content: body.choices?.[0]?.message?.content,
    assertions: {
      gatewayReturned200: res.statusCode === 200,
      providerIsOllama: body.tokenops?.provider === "ollama",
      hasContent: typeof body.choices?.[0]?.message?.content === "string" && body.choices[0].message.content.length > 0,
    },
  };
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(report.assertions).every(Boolean)) process.exit(1);
}

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

function writeReport(value: unknown): void {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(value, null, 2)}\n`);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
