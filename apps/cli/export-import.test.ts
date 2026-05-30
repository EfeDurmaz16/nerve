import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { insertTokenOpsProviderAttempt, openDb } from "@nerve/store";
import type { RequestTrace } from "@tokenops/core";
import { SqliteTraceStore } from "@tokenops/ledger";
import { createApp } from "../server/src/index.js";

const execFileAsync = promisify(execFile);

describe("tokenops snapshot CLI", () => {
  it("exports and imports local TokenOps traces and benchmark results", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-snapshot-cli-"));
    const sourceDb = join(dir, "source.db");
    const targetDb = join(dir, "target.db");
    const snapshot = join(dir, "snapshot.json");

    execTokenOps(["replay", "benchmark/datasets/docs-qa.jsonl", "--persist"], sourceDb);
    execTokenOps(["export", snapshot], sourceDb);
    const exported = JSON.parse(readFileSync(snapshot, "utf8")) as {
      schema_version: string;
      benchmark_results: unknown[];
    };
    expect(exported.schema_version).toBe("tokenops.snapshot.v1");
    expect(exported.benchmark_results.length).toBeGreaterThan(0);

    const imported = execTokenOps(["import", snapshot], targetDb);
    expect(imported).toContain("imported");
    const stats = JSON.parse(execTokenOps(["stats"], targetDb)) as { tokenops_benchmark_results: number };
    expect(stats.tokenops_benchmark_results).toBeGreaterThan(0);
  });

  it("prunes persisted TokenOps benchmark evidence from the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-prune-cli-"));
    const db = join(dir, "tokenops.db");

    execTokenOps(["replay", "benchmark/datasets/docs-qa.jsonl", "--persist"], db);
    execTokenOps(["replay", "benchmark/datasets/support-faq.jsonl", "--persist"], db);
    const before = JSON.parse(execTokenOps(["stats"], db)) as { tokenops_benchmark_results: number };
    expect(before.tokenops_benchmark_results).toBe(2);

    const pruned = JSON.parse(execTokenOps(["prune", "--keep-benchmarks", "1"], db)) as { benchmark_results: number };
    expect(pruned.benchmark_results).toBe(1);
    const after = JSON.parse(execTokenOps(["stats"], db)) as { tokenops_benchmark_results: number };
    expect(after.tokenops_benchmark_results).toBe(1);
  });

  it("simulates policy impact from local TokenOps traces", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-policy-sim-cli-"));
    const dbPath = join(dir, "tokenops.db");
    const store = new SqliteTraceStore(openDb(dbPath));
    store.insert(trace("first", 0.01));
    store.insert(trace("expensive", 0.03));

    const simulation = JSON.parse(execTokenOps([
      "policy",
      "simulate",
      "--daily-budget-usd",
      "0.01",
      "--max-request-cost-usd",
      "0.02",
    ], dbPath)) as { totalTraces: number; blocked: number; estimatedAvoidedCostUsd: number };

    expect(simulation.totalTraces).toBe(2);
    expect(simulation.blocked).toBe(1);
    expect(simulation.estimatedAvoidedCostUsd).toBeCloseTo(0.03);
  });

  it("reconciles provider usage JSONL against local TokenOps traces", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-reconcile-cli-"));
    const dbPath = join(dir, "tokenops.db");
    const usagePath = join(dir, "usage.jsonl");
    const store = new SqliteTraceStore(openDb(dbPath));
    store.insert(trace("tr_invoice", 0.000028));
    writeFileSync(usagePath, `${JSON.stringify({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      trace_id: "tr_invoice",
      request_hash: "tr_invoice",
      input_tokens: 42,
      output_tokens: 4,
      actual_cost_usd: 0.001,
    })}\n`);

    const report = JSON.parse(execTokenOps(["reconcile", usagePath], dbPath)) as { totalUsageRecords: number; drifted: number; deltaUsd: number };

    expect(report.totalUsageRecords).toBe(1);
    expect(report.drifted).toBe(1);
    expect(report.deltaUsd).toBeCloseTo(0.000972);
  });

  it("exports provider attempts as reconciliation usage JSONL", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-provider-usage-cli-"));
    const dbPath = join(dir, "tokenops.db");
    insertTokenOpsProviderAttempt(openDb(dbPath), {
      id: "att_usage",
      trace_id: "tr_usage",
      request_hash: "hash_usage",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      ok: true,
      latency_ms: 25,
      input_tokens: 42,
      output_tokens: 4,
      estimated_cost_usd: 0.000028,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const output = execTokenOps(["providers", "usage"], dbPath).trim();
    expect(JSON.parse(output)).toMatchObject({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      trace_id: "tr_usage",
      request_hash: "hash_usage",
      input_tokens: 42,
      output_tokens: 4,
      actual_cost_usd: 0.000028,
    });
  });

  it("exports local TokenOps traces as OpenTelemetry JSONL", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-otel-cli-"));
    const dbPath = join(dir, "tokenops.db");
    const outPath = join(dir, "spans.jsonl");
    const store = new SqliteTraceStore(openDb(dbPath));
    store.insert(trace("tr_otel_cli", 0.000028));

    execTokenOps(["traces", "export", "--format", "otel", "--out", outPath], dbPath);
    const lines = readFileSync(outPath, "utf8").trim().split(/\r?\n/);
    const span = JSON.parse(lines[0]!) as { name: string; traceId: string; attributes: Record<string, unknown> };

    expect(span.name).toBe("tokenops.inference");
    expect(span.traceId).toBe("tr_otel_cli");
    expect(span.attributes["tokenops.cost.optimized_usd"]).toBe(0.000028);
  });

  it("runs semantic cache threshold sweep from the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-cache-sweep-cli-"));
    const dbPath = join(dir, "tokenops.db");

    const result = JSON.parse(execTokenOps(["cache", "eval", "benchmark/evals/semantic-cache-safety.jsonl", "--sweep", "--thresholds", "0.2,0.3,0.5"], dbPath)) as {
      thresholds: unknown[];
      recommendedThreshold: number | null;
    };

    expect(result.thresholds).toHaveLength(3);
    expect(result.recommendedThreshold).not.toBeNull();
  });

  it("runs load-shedding proof from the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-load-shedding-cli-"));
    const dbPath = join(dir, "tokenops.db");

    const result = JSON.parse(execTokenOps(["load-shedding"], dbPath)) as {
      foregroundAdmitted: boolean;
      shedBackgroundRequests: number;
      passed: boolean;
    };

    expect(result.foregroundAdmitted).toBe(true);
    expect(result.shedBackgroundRequests).toBeGreaterThan(0);
    expect(result.passed).toBe(true);
  });

  it("runs HTTP gateway smoke against a live TokenOps server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-gateway-smoke-cli-"));
    const dbPath = join(dir, "tokenops.db");
    await withEnv({
      TOKENOPS_PROVIDER: "mock",
      TOKENOPS_MOCK_DELAY_MS: "40",
      TOKENOPS_MAX_CONCURRENT_INFERENCE: "1",
      TOKENOPS_MAX_INFERENCE_QUEUE: "1",
    }, async () => {
      const app = createApp({ db: openDb(dbPath), dbPath });
      await app.listen({ port: 0, host: "127.0.0.1" });
      try {
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("expected TCP listener address");
        const result = JSON.parse(await execTokenOpsAsync(["gateway", "smoke", "--url", `http://127.0.0.1:${address.port}`, "--admission"], dbPath)) as {
          passed: boolean;
          ready: { ready: boolean };
          models: { object: string; data: Array<{ id: string }> };
          basic: { passed: boolean; exactCacheObserved: boolean };
          admission?: { passed: boolean; shedObserved: boolean; foregroundAdmitted: boolean };
        };

        expect(result.passed).toBe(true);
        expect(result.ready.ready).toBe(true);
        expect(result.models.object).toBe("list");
        expect(result.models.data.some((model) => model.id === "gpt-5-mini")).toBe(true);
        expect(result.basic.passed).toBe(true);
        expect(result.basic.exactCacheObserved).toBe(true);
        expect(result.admission?.passed).toBe(true);
        expect(result.admission?.shedObserved).toBe(true);
        expect(result.admission?.foregroundAdmitted).toBe(true);
      } finally {
        await app.close();
      }
    });
  });

  it("checks required provider in HTTP gateway smoke", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-provider-smoke-cli-"));
    const dbPath = join(dir, "tokenops.db");
    let chatCalls = 0;
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET" && req.url === "/health") return res.end(JSON.stringify({ ok: true }));
      if (req.method === "GET" && req.url === "/ready") return res.end(JSON.stringify({ ready: true }));
      if (req.method === "GET" && req.url === "/v1/models") return res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-5-mini" }] }));
      if (req.method === "GET" && req.url === "/stats") return res.end(JSON.stringify({ requests: chatCalls }));
      if (req.method === "GET" && req.url === "/runtime/stats") return res.end(JSON.stringify({ scheduler: { admitted: chatCalls } }));
      if (req.method === "GET" && req.url === "/cache/stats") return res.end(JSON.stringify({ exact: { hits: Math.max(0, chatCalls - 1) } }));
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        chatCalls += 1;
        return res.end(JSON.stringify({
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          tokenops: {
            provider: "groq",
            trace_id: `tr_fake_${chatCalls}`,
            cache: { exactHit: chatCalls === 3 },
            runtime: { coalesced: false, stats: { scheduler: { admitted: chatCalls } } },
          },
        }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("expected TCP listener address");
      const result = JSON.parse(await execTokenOpsAsync(["gateway", "smoke", "--url", `http://127.0.0.1:${address.port}`, "--require-provider", "groq"], dbPath)) as {
        passed: boolean;
        basic: { providerObserved: string; requiredProvider: string; requiredProviderObserved: boolean };
      };
      expect(result.passed).toBe(true);
      expect(result.basic.providerObserved).toBe("groq");
      expect(result.basic.requiredProvider).toBe("groq");
      expect(result.basic.requiredProviderObserved).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("prints product demo readiness as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-demo-json-cli-"));
    const dbPath = join(dir, "tokenops.db");

    const result = JSON.parse(execTokenOps([
      "demo",
      "--json",
      "--load-requests",
      "6",
      "--load-concurrency",
      "3",
      "--batch-requests",
      "6",
      "--throughput-requests",
      "3",
      "--throughput-concurrency",
      "2",
    ], dbPath)) as {
      readyForLocalDemo: boolean;
      replay: { estimatedCostReductionPct: number };
      runtime: { loadShedding: { foregroundAdmitted: boolean } };
      gateway: { compatibility: boolean; smokeCommand: string };
      verification: Array<{ area: string; command: string }>;
    };

    expect(result.readyForLocalDemo).toBe(true);
    expect(result.replay.estimatedCostReductionPct).toBeGreaterThan(0);
    expect(result.runtime.loadShedding.foregroundAdmitted).toBe(true);
    expect(result.gateway.compatibility).toBe(true);
    expect(result.gateway.smokeCommand).toContain("gateway smoke");
    expect(result.verification.find((entry) => entry.area === "http-gateway-smoke")?.command).toContain("gateway smoke");
  });

  it("runs local-safe readiness verification from the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-readiness-cli-"));
    const dbPath = join(dir, "tokenops.db");

    const result = JSON.parse(execTokenOps([
      "verify",
      "readiness",
      "--json",
      "--load-requests",
      "6",
      "--load-concurrency",
      "3",
      "--batch-requests",
      "6",
      "--throughput-requests",
      "3",
      "--throughput-concurrency",
      "2",
    ], dbPath)) as {
      readyForLocalDemo: boolean;
      checks: Array<{ area: string; status: string }>;
      failed: string[];
      manual: string[];
    };

    expect(result.readyForLocalDemo).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.checks.find((entry) => entry.area === "replay-benchmark")?.status).toBe("pass");
    expect(result.checks.find((entry) => entry.area === "http-gateway-smoke")?.status).toBe("manual");
    expect(result.manual).toContain("http-gateway-smoke");
  });

  it("prints provider arbitrage route from local TokenOps traces", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenops-arbitrage-cli-"));
    const dbPath = join(dir, "tokenops.db");
    const store = new SqliteTraceStore(openDb(dbPath));
    store.insert(trace("openai_1", 0.04, "openai", 700));
    store.insert(trace("openai_2", 0.04, "openai", 650));
    store.insert(trace("groq_1", 0.01, "groq", 300));
    store.insert(trace("groq_2", 0.01, "groq", 320));
    store.insert(trace("mock_bad_1", 0, "mock", 30, false));
    store.insert(trace("mock_bad_2", 0, "mock", 25, false));

    const result = JSON.parse(execTokenOps([
      "routing",
      "arbitrage",
      "--provider",
      "openai",
      "--candidates",
      "openai,groq,mock",
      "--min-health",
      "0.8",
      "--max-p95-ms",
      "1000",
    ], dbPath)) as { route: { selectedProvider: string }; selectedHealth?: { averageOptimizedCostUsd: number } };

    expect(result.route.selectedProvider).toBe("groq");
    expect(result.selectedHealth?.averageOptimizedCostUsd).toBe(0.01);
  });
});

function execTokenOps(args: string[], dbPath: string): string {
  return execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, TOKENOPS_CLI: "1", NERVE_DB: dbPath },
    encoding: "utf8",
  });
}

async function execTokenOpsAsync(args: string[], dbPath: string): Promise<string> {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", "apps/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, TOKENOPS_CLI: "1", NERVE_DB: dbPath },
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.stdout;
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

function trace(
  id: string,
  baseline: number,
  provider = "mock",
  latency = 50,
  verifierPassed = true,
): RequestTrace {
  return {
    id,
    timestamp: "2026-05-30T00:00:00.000Z",
    workloadType: "chat",
    userId: "cli-user",
    requestedModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    selectedProvider: provider,
    inputTokensEstimated: 100,
    outputTokensEstimated: 50,
    providerLatencyMs: latency,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: provider, selectedModel: "gpt-5.5", originalRequestedModel: "gpt-5.5", downgraded: false, escalated: false, reason: "fixture" },
    policy: { allowed: true, reason: "fixture" },
    cost: { estimatedBaselineCost: baseline, estimatedOptimizedCost: baseline, estimatedSavings: 0 },
    quality: { verifierUsed: true, verifierPassed },
    normalizedHash: id,
    finalResponseSource: "model",
  };
}
