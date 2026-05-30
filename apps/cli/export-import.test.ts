import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});

function execTokenOps(args: string[], dbPath: string): string {
  return execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, TOKENOPS_CLI: "1", NERVE_DB: dbPath },
    encoding: "utf8",
  });
}
