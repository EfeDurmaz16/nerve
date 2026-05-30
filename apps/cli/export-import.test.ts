import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "@nerve/store";
import type { RequestTrace } from "@tokenops/core";
import { SqliteTraceStore } from "@tokenops/ledger";

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
});

function execTokenOps(args: string[], dbPath: string): string {
  return execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, TOKENOPS_CLI: "1", NERVE_DB: dbPath },
    encoding: "utf8",
  });
}

function trace(id: string, baseline: number): RequestTrace {
  return {
    id,
    timestamp: "2026-05-30T00:00:00.000Z",
    workloadType: "chat",
    userId: "cli-user",
    requestedModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    selectedProvider: "mock",
    inputTokensEstimated: 100,
    outputTokensEstimated: 50,
    cache: { exactHit: false, semanticHit: false, toolResultHit: false, contextBlockHit: false, prefixCacheEligibleTokens: 0 },
    routing: { selectedProvider: "mock", selectedModel: "gpt-5.5", originalRequestedModel: "gpt-5.5", downgraded: false, escalated: false, reason: "fixture" },
    policy: { allowed: true, reason: "fixture" },
    cost: { estimatedBaselineCost: baseline, estimatedOptimizedCost: baseline, estimatedSavings: 0 },
    normalizedHash: id,
    finalResponseSource: "model",
  };
}
