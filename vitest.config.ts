import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => resolve(root, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      "@nerve/ir": pkg("ir"),
      "@nerve/store": pkg("store"),
      "@nerve/verifiers": pkg("verifiers"),
      "@nerve/importers": pkg("importers"),
      "@nerve/miner": pkg("miner"),
      "@nerve/learner": pkg("learner"),
      "@nerve/planner": pkg("planner"),
      "@nerve/replay": pkg("replay"),
      "@nerve/sdk-ts": pkg("sdk-ts"),
      "@tokenops/core": pkg("core"),
      "@tokenops/gateway": pkg("gateway"),
      "@tokenops/providers": pkg("providers"),
      "@tokenops/ledger": pkg("ledger"),
      "@tokenops/cache": pkg("cache"),
      "@tokenops/profiler": pkg("profiler"),
      "@tokenops/router": pkg("router"),
      "@tokenops/policy": pkg("policy"),
      "@tokenops/ais": pkg("ais"),
      "@tokenops/verifier": pkg("verifier"),
      "@tokenops/benchmark": pkg("benchmark"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 15000,
  },
});
