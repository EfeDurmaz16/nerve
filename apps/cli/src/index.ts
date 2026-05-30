import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import kleur from "kleur";
import { openDb, insertTrace, listClusters, listPatches, updatePatchStatus, countTraces, getPatch, exportTokenOpsSnapshot, importTokenOpsSnapshot, insertTokenOpsBenchmarkResult } from "@nerve/store";
import { compileTask } from "@nerve/planner";
import { mineAll } from "@nerve/miner";
import { generateEvals, learn } from "@nerve/learner";
import { replay } from "@nerve/replay";
import { importJsonl } from "@nerve/importers";
import { parseOrThrow, TaskEnvelope, newId, nowIso } from "@nerve/ir";
import {
  formatBenchmark,
  formatReadinessMarkdown,
  replayAll,
  replayDataset,
  runBatchBenchmark,
  runCheapThenVerifyBenchmark,
  runLoadBenchmark,
  runProviderFailoverBenchmark,
  runProviderSloBenchmark,
  runProviderThroughputBenchmark,
  runReadinessBenchmark,
  runSemanticCacheSafetyBenchmark,
} from "@tokenops/benchmark";
import type { ModelResponse, NormalizedRequest } from "@tokenops/core";
import { providerHealthReport, SqliteTraceStore } from "@tokenops/ledger";
import type { ModelProvider } from "@tokenops/providers";
import { learnRoutingPolicy, learnSloRoutingPolicy } from "@tokenops/router";
import { evaluateVerifierCases } from "@tokenops/verifier";
import type { VerifierEvalCase } from "@tokenops/verifier";
import { runDoctorCheck } from "./doctor.js";

const DB_PATH = process.env.NERVE_DB ?? resolve(homedir(), ".nerve/nerve.db");
const NERVE_DIR = resolve(homedir(), ".nerve");
const BIN_NAME = process.env.TOKENOPS_CLI === "1" ? "tokenops" : basename(process.argv[1] ?? "nerve");

loadDotEnv(resolve(process.cwd(), ".env"));

function usage(): never {
  if (BIN_NAME.includes("tokenops")) {
    console.log(`
${kleur.bold("tokenops")} — adaptive inference control plane

usage:
  tokenops serve                         start OpenAI-compatible gateway on :8787
  tokenops replay <dataset>              run baseline-vs-optimized benchmark
  tokenops replay --all                  run all benchmark datasets
  tokenops export <file>                 export local TokenOps traces and benchmark results
  tokenops import <file>                 import a TokenOps snapshot
  tokenops load                          run local concurrent inference runtime benchmark
  tokenops batch                         run local micro-batching throughput benchmark
  tokenops failover                      run provider circuit-breaker/fallback benchmark
  tokenops throughput [mock|ollama|groq] measure provider throughput and tokens/sec
  tokenops proof                         write product-readiness proof report
  tokenops doctor                        inspect local setup, git hygiene, providers, and proof status
  tokenops stats                         show local DB stats
  tokenops trace <id>                    show trace lookup instructions
  tokenops cache stats                   show cache stats endpoint hint
  tokenops cache clear                   show cache clear endpoint hint
  tokenops cache eval [dataset]          run adversarial semantic-cache safety eval
  tokenops analyze [--trace <id>]        show analyzer endpoint hint
  tokenops budget status                 show budget endpoint hint
  tokenops routing policy                learn and print routing policy from local traces
  tokenops routing slo                   learn and print provider SLO policy from local traces
  tokenops routing slo-benchmark         run synthetic SLO rerouting benchmark
  tokenops providers health              score provider health from local traces
  tokenops verify eval [--dataset file]  run verifier eval harness
  tokenops verify routing [dataset]      run cheap-then-verify routing eval
  tokenops compare groq                  run live Groq direct-vs-gateway comparison
  tokenops compare openai                run live OpenAI direct-vs-gateway comparison
  tokenops smoke ollama                  run availability-aware Ollama gateway smoke
  tokenops demo                          run replay demo over all datasets
`);
    process.exit(2);
  }
  console.log(`
${kleur.bold("nerve")} — inference compiler for agents

usage:
  nerve init                              create ~/.nerve, print token
  nerve serve                             start API on :7777
  nerve import <file|glob>                ingest JSONL traces
  nerve mine                              cluster failures from stored traces
  nerve clusters                          list failure clusters
  nerve learn [--cluster <id>]            generate teachings + patch candidates
  nerve evals gen [--cluster <id>]        generate eval cases from clusters
  nerve replay --patch <id|all> [--sample N]   before/after delta report
  nerve patches list [--status proposed|approved|rejected|live]
  nerve patches approve <id> [<id> ...]
  nerve patches reject  <id> [<id> ...]
  nerve compile <file.json>               compile a TaskEnvelope JSON file
  nerve db                                print db path + counts
  nerve --help
`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const cmd = argv[0];

async function main() {
  if (!cmd || cmd === "--help" || cmd === "-h") usage();

  if (BIN_NAME.includes("tokenops")) {
    if (cmd === "serve") return cmdServe();
    if (cmd === "replay") return cmdTokenOpsReplay(argv.slice(1));
    if (cmd === "export") return cmdTokenOpsExport(argv.slice(1));
    if (cmd === "import") return cmdTokenOpsImport(argv.slice(1));
    if (cmd === "load") return cmdTokenOpsLoad(argv.slice(1));
    if (cmd === "batch") return cmdTokenOpsBatch(argv.slice(1));
    if (cmd === "failover") return cmdTokenOpsFailover(argv.slice(1));
    if (cmd === "throughput") return cmdTokenOpsThroughput(argv.slice(1));
    if (cmd === "proof") return cmdTokenOpsProof(argv.slice(1));
    if (cmd === "doctor") return cmdTokenOpsDoctor();
    if (cmd === "demo") return cmdTokenOpsDemo();
    if (cmd === "stats") return cmdDb();
    if (cmd === "trace") return console.log(`GET http://127.0.0.1:${process.env.TOKENOPS_PORT ?? "8787"}/traces/${argv[1] ?? "<id>"}`);
    if (cmd === "cache" && argv[1] === "stats") return console.log(`GET http://127.0.0.1:${process.env.TOKENOPS_PORT ?? "8787"}/cache/stats`);
    if (cmd === "cache" && argv[1] === "clear") return console.log(`POST http://127.0.0.1:${process.env.TOKENOPS_PORT ?? "8787"}/cache/clear`);
    if (cmd === "cache" && argv[1] === "eval") return cmdTokenOpsCacheEval(argv.slice(2));
    if (cmd === "analyze") return console.log(`GET http://127.0.0.1:${process.env.TOKENOPS_PORT ?? "8787"}/analyze${getOpt(argv.slice(1), "--trace") ? `?trace=${getOpt(argv.slice(1), "--trace")}` : ""}`);
    if (cmd === "budget" && argv[1] === "status") return console.log(`GET http://127.0.0.1:${process.env.TOKENOPS_PORT ?? "8787"}/budget/status`);
    if (cmd === "routing" && argv[1] === "policy") return cmdTokenOpsRoutingPolicy();
    if (cmd === "routing" && argv[1] === "slo") return cmdTokenOpsRoutingSlo();
    if (cmd === "routing" && argv[1] === "slo-benchmark") return cmdTokenOpsRoutingSloBenchmark();
    if (cmd === "providers" && argv[1] === "health") return cmdTokenOpsProvidersHealth();
    if (cmd === "verify" && argv[1] === "eval") return cmdTokenOpsVerifyEval();
    if (cmd === "verify" && argv[1] === "routing") return cmdTokenOpsVerifyRouting(argv.slice(2));
    if (cmd === "compare" && argv[1] === "groq") return cmdTokenOpsCompareGroq();
    if (cmd === "compare" && argv[1] === "openai") return cmdTokenOpsCompareOpenAI();
    if (cmd === "smoke" && argv[1] === "ollama") return cmdTokenOpsSmokeOllama();
    console.error(kleur.red(`unknown tokenops command: ${cmd}`));
    usage();
  }

  if (cmd === "init") return cmdInit();
  if (cmd === "serve") return cmdServe();
  if (cmd === "import") return cmdImport(argv.slice(1));
  if (cmd === "mine") return cmdMine();
  if (cmd === "clusters") return cmdClusters();
  if (cmd === "learn") return cmdLearn(argv.slice(1));
  if (cmd === "evals" && argv[1] === "gen") return cmdEvalsGen(argv.slice(2));
  if (cmd === "replay") return cmdReplay(argv.slice(1));
  if (cmd === "patches") return cmdPatches(argv.slice(1));
  if (cmd === "compile") return cmdCompile(argv.slice(1));
  if (cmd === "db") return cmdDb();

  console.error(kleur.red(`unknown command: ${cmd}`));
  usage();
}

// ─── commands ────────────────────────────────────────────────────────────────
function cmdInit() {
  mkdirSync(NERVE_DIR, { recursive: true });
  const tokenFile = resolve(NERVE_DIR, "token");
  let token: string;
  if (existsSync(tokenFile)) {
    token = readFileSync(tokenFile, "utf8").trim();
  } else {
    token = newId("ner").replace("ner_", "ner");
    writeFileSync(tokenFile, token + "\n", { mode: 0o600 });
  }
  openDb(DB_PATH); // creates + migrates
  console.log(kleur.green("✓ initialized"));
  console.log(`  db:    ${DB_PATH}`);
  console.log(`  token: ${token}`);
  console.log(`\nexport NERVE_TOKEN=${token}`);
}

function cmdServe() {
  // Resolve repo root by walking up from this file's directory.
  const child = spawn("pnpm", ["--filter", "@nerve/server", "start"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (c) => process.exit(c ?? 0));
}

async function cmdTokenOpsReplay(args: string[]) {
  const persist = args.includes("--persist");
  if (args.includes("--all")) {
    const results = await replayAll();
    for (const result of results) {
      console.log(formatBenchmark(result));
      console.log("");
    }
    if (persist) persistBenchmarkResults(results);
    return;
  }
  const dataset = args.find((arg) => !arg.startsWith("--"));
  if (!dataset) return die("usage: tokenops replay <dataset>|--all");
  const result = await replayDataset(dataset);
  if (persist) persistBenchmarkResults([result]);
  console.log(formatBenchmark(result));
}

function cmdTokenOpsExport(args: string[]) {
  const file = args[0];
  if (!file) return die("usage: tokenops export <file>");
  const db = openDb(DB_PATH);
  const snapshot = exportTokenOpsSnapshot(db, {
    traceLimit: Number(getOpt(args, "--trace-limit") ?? 10_000),
    benchmarkLimit: Number(getOpt(args, "--benchmark-limit") ?? 10_000),
  });
  writeFileSync(resolve(file), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(kleur.green(`✓ exported ${snapshot.traces.length} traces and ${snapshot.benchmark_results.length} benchmark results to ${resolve(file)}`));
}

function cmdTokenOpsImport(args: string[]) {
  const file = args[0];
  if (!file) return die("usage: tokenops import <file>");
  const db = openDb(DB_PATH);
  const snapshot = JSON.parse(readFileSync(resolve(file), "utf8")) as ReturnType<typeof exportTokenOpsSnapshot>;
  const imported = importTokenOpsSnapshot(db, snapshot);
  console.log(kleur.green(`✓ imported ${imported.traces} traces and ${imported.benchmark_results} benchmark results from ${resolve(file)}`));
}

async function cmdTokenOpsLoad(args: string[]) {
  const result = await runLoadBenchmark({
    requests: Number(getOpt(args, "--requests") ?? 40),
    concurrency: Number(getOpt(args, "--concurrency") ?? 10),
    duplicateRatio: Number(getOpt(args, "--duplicate-ratio") ?? 0.5),
    providerLatencyMs: Number(getOpt(args, "--provider-latency-ms") ?? 25),
    maxConcurrentInference: Number(getOpt(args, "--max-concurrent-inference") ?? getOpt(args, "--concurrency") ?? 10),
    maxQueue: Number(getOpt(args, "--max-queue") ?? 100),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdTokenOpsBatch(args: string[]) {
  const result = await runBatchBenchmark({
    requests: Number(getOpt(args, "--requests") ?? 32),
    batchSize: Number(getOpt(args, "--batch-size") ?? 8),
    batchWindowMs: Number(getOpt(args, "--batch-window-ms") ?? 5),
    perBatchOverheadMs: Number(getOpt(args, "--per-batch-overhead-ms") ?? 20),
    perItemLatencyMs: Number(getOpt(args, "--per-item-latency-ms") ?? 2),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdTokenOpsFailover(args: string[]) {
  const result = await runProviderFailoverBenchmark({
    requests: Number(getOpt(args, "--requests") ?? 12),
    primaryFailuresBeforeSuccess: Number(getOpt(args, "--primary-failures-before-success") ?? 12),
    circuitFailureThreshold: Number(getOpt(args, "--circuit-failure-threshold") ?? 2),
    fallbackLatencyMs: Number(getOpt(args, "--fallback-latency-ms") ?? 1),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failedResponses > 0 || !result.circuitOpened) process.exit(1);
}

async function cmdTokenOpsThroughput(args: string[]) {
  const positionalProvider = args.find((arg) => !arg.startsWith("--"));
  const provider = getOpt(args, "--provider") ?? positionalProvider ?? "mock";
  if (provider !== "mock" && provider !== "ollama" && provider !== "groq") return die("usage: tokenops throughput [mock|ollama|groq]");
  const result = await runProviderThroughputBenchmark({
    provider,
    model: getOpt(args, "--model"),
    requests: Number(getOpt(args, "--requests") ?? 24),
    concurrency: Number(getOpt(args, "--concurrency") ?? 6),
    providerLatencyMs: Number(getOpt(args, "--provider-latency-ms") ?? 0),
    maxConcurrentInference: Number(getOpt(args, "--max-concurrent-inference") ?? getOpt(args, "--concurrency") ?? 6),
    maxQueue: Number(getOpt(args, "--max-queue") ?? 100),
    baseUrl: getOpt(args, "--base-url"),
    availabilityTimeoutMs: Number(getOpt(args, "--availability-timeout-ms") ?? 750),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdTokenOpsProof(args: string[]) {
  const report = await runReadinessBenchmark({
    includeGroq: args.includes("--include-groq"),
    loadRequests: Number(getOpt(args, "--load-requests") ?? 30),
    loadConcurrency: Number(getOpt(args, "--load-concurrency") ?? 10),
    batchRequests: Number(getOpt(args, "--batch-requests") ?? 24),
    throughputRequests: Number(getOpt(args, "--throughput-requests") ?? 12),
    throughputConcurrency: Number(getOpt(args, "--throughput-concurrency") ?? 4),
  });
  const jsonPath = resolve("docs/experiments/tokenops-product-readiness-report.json");
  const mdPath = resolve("docs/experiments/tokenops-product-readiness.md");
  mkdirSync(resolve("docs/experiments"), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, formatReadinessMarkdown(report));
  console.log(JSON.stringify({ reportPath: jsonPath, markdownPath: mdPath, summary: report.summary, passed: report.passed, gaps: report.gaps }, null, 2));
  if (!report.summary.readyForLocalDemo) process.exit(1);
}

async function cmdTokenOpsDoctor() {
  const port = Number(process.env.TOKENOPS_PORT ?? process.env.NERVE_PORT ?? 8787);
  const report = runDoctorCheck({ portInUse: await isPortInUse(port) });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "fail") process.exit(1);
}

async function cmdTokenOpsDemo() {
  console.log(kleur.bold("TokenOps demo: baseline direct calls vs optimized gateway simulation"));
  const results = await replayAll();
  let baseline = 0;
  let optimized = 0;
  for (const result of results) {
    baseline += result.baseline_cost;
    optimized += result.optimized_cost;
    console.log("");
    console.log(formatBenchmark(result));
  }
  const reduction = baseline === 0 ? 0 : ((baseline - optimized) / baseline) * 100;
  console.log("");
  console.log(kleur.green(`Estimated total cost reduction: ${reduction.toFixed(1)}%`));
  console.log(kleur.cyan("AIS: foreground cache/model decisions and background verification are included in gateway traces when tokenops serve is running."));
  console.log(kleur.cyan("Analyzer: run tokenops analyze after gateway traffic for could-have-been-cheaper insights."));
}

async function cmdTokenOpsCacheEval(args: string[]) {
  const dataset = args[0] ?? "benchmark/evals/semantic-cache-safety.jsonl";
  const result = await runSemanticCacheSafetyBenchmark(dataset);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exit(1);
}

function cmdTokenOpsRoutingPolicy() {
  const db = openDb(DB_PATH);
  const store = new SqliteTraceStore(db);
  const policy = learnRoutingPolicy(store.list(10_000), { minSamples: Number(process.env.TOKENOPS_ROUTING_MIN_SAMPLES ?? 2) });
  console.log(JSON.stringify(policy, null, 2));
}

function cmdTokenOpsRoutingSlo() {
  const db = openDb(DB_PATH);
  const store = new SqliteTraceStore(db);
  const policy = learnSloRoutingPolicy(store.list(10_000), {
    windowSize: Number(process.env.TOKENOPS_SLO_WINDOW_SIZE ?? 100),
    maxErrorRate: Number(process.env.TOKENOPS_SLO_MAX_ERROR_RATE ?? 0.1),
    maxP95LatencyMs: Number(process.env.TOKENOPS_SLO_MAX_P95_LATENCY_MS ?? 10_000),
    maxAverageCostUsd: Number(process.env.TOKENOPS_SLO_MAX_AVERAGE_COST_USD ?? Number.MAX_SAFE_INTEGER),
  });
  console.log(JSON.stringify(policy, null, 2));
}

function cmdTokenOpsRoutingSloBenchmark() {
  const result = runProviderSloBenchmark();
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exit(1);
}

function cmdTokenOpsProvidersHealth() {
  const db = openDb(DB_PATH);
  const store = new SqliteTraceStore(db);
  console.log(JSON.stringify(providerHealthReport(store.list(10_000)), null, 2));
}

async function cmdTokenOpsVerifyEval() {
  const dataset = getOpt(argv.slice(1), "--dataset");
  const cases = dataset ? readVerifierCases(dataset) : [
    { id: "grounded-docs-answer", request: [{ role: "user" as const, content: "Answer from docs only." }], response: "Grounded docs answer.", expected: "passed" as const },
    { id: "unsupported-answer", request: [{ role: "user" as const, content: "Answer from docs only." }], response: "Invented claim not in docs.", expected: "failed" as const },
    { id: "ambiguous-answer", request: [{ role: "user" as const, content: "Ambiguous request." }], response: "Maybe.", expected: "uncertain" as const },
  ];
  const result = await evaluateVerifierCases({
    provider: new StaticJudgeProvider(cases.map((testCase) => judgmentForExpected(testCase.expected))),
    cases,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdTokenOpsVerifyRouting(args: string[]) {
  const dataset = args[0] ?? "benchmark/evals/cheap-then-verify.jsonl";
  const result = await runCheapThenVerifyBenchmark(dataset);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exit(1);
}

function cmdTokenOpsCompareGroq() {
  const child = spawn("npx", ["tsx", "scripts/compare-groq.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (c) => process.exit(c ?? 0));
}

function cmdTokenOpsCompareOpenAI() {
  const child = spawn("npx", ["tsx", "scripts/compare-openai.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (c) => process.exit(c ?? 0));
}

function cmdTokenOpsSmokeOllama() {
  const child = spawn("npx", ["tsx", "scripts/smoke-ollama.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (c) => process.exit(c ?? 0));
}

function cmdImport(args: string[]) {
  if (args.length === 0) return die("usage: nerve import <file...>");
  const db = openDb(DB_PATH);
  const files = expandFiles(args);
  let total = 0;
  for (const f of files) {
    const results = importJsonl(f);
    for (const { trace } of results) insertTrace(db, trace);
    total += results.length;
    console.log(`  ${kleur.dim("←")} ${f}  (${results.length})`);
  }
  console.log(kleur.green(`✓ imported ${total} traces`));
  const report = mineAll(db);
  console.log(
    kleur.cyan(
      `→ mined ${report.clusters} clusters from ${report.failures} failures (of ${countTraces(db).total} traces)`,
    ),
  );
  for (const s of report.cluster_summaries.slice(0, 10)) {
    console.log(`   • ${kleur.yellow(s.mode.padEnd(14))} ${s.label}  ${kleur.dim(`×${s.freq}`)}`);
  }
}

function cmdMine() {
  const db = openDb(DB_PATH);
  const r = mineAll(db);
  console.log(JSON.stringify(r, null, 2));
}

function cmdClusters() {
  const db = openDb(DB_PATH);
  const cs = listClusters(db);
  for (const c of cs) {
    console.log(
      `${kleur.cyan(c.cluster_id)}  ${kleur.yellow(c.failure_mode.padEnd(14))}  ×${String(c.frequency).padStart(3)}  ${c.label}`,
    );
  }
  console.log(kleur.dim(`(${cs.length} clusters)`));
}

function cmdLearn(args: string[]) {
  const db = openDb(DB_PATH);
  const clusterId = getOpt(args, "--cluster");
  const r = learn(db, { cluster_ids: clusterId ? [clusterId] : null });
  console.log(kleur.green(`✓ ${r.teachings.length} teachings, ${r.patches.length} patches proposed`));
  for (const p of r.patches) {
    console.log(`  ${kleur.cyan(p.patch_id)}  ${kleur.yellow(p.type.padEnd(16))}  cluster=${p.origin_cluster_id?.slice(-6)}`);
  }
}

function cmdEvalsGen(args: string[]) {
  const db = openDb(DB_PATH);
  const clusterId = getOpt(args, "--cluster");
  const r = generateEvals(db, { cluster_ids: clusterId ? [clusterId] : null });
  console.log(kleur.green(`✓ generated ${r.evals.length} eval cases`));
}

function cmdReplay(args: string[]) {
  const db = openDb(DB_PATH);
  const patchArg = getOpt(args, "--patch") ?? "all";
  const sample = Number(getOpt(args, "--sample") ?? "1000");
  const patches = patchArg === "all" ? listPatches(db, { status: "proposed" }) : [];
  const patch_ids = patchArg === "all" ? patches.map((p) => p.patch_id) : patchArg.split(",");
  if (patch_ids.length === 0) return die("no patches to replay");
  const out = replay(db, { patch_ids, baseline: "current_policy", sample });
  console.log(
    `${kleur.bold("baseline")}     pass_rate=${out.baseline.pass_rate}  cost=$${out.baseline.cost_usd}  p50=${out.baseline.latency_ms_p50}ms`,
  );
  for (const c of out.candidates) {
    const dpr = c.delta.pass_rate;
    const sign = dpr >= 0 ? "+" : "";
    const col = dpr >= 0 ? kleur.green : kleur.red;
    console.log(
      `${kleur.bold("candidate")}    ${kleur.cyan(c.patch_id.slice(-10))}  pass_rate=${c.pass_rate} (${col(sign + dpr.toFixed(3))})  cost=$${c.cost_usd} (Δ$${c.delta.cost_usd})  regressions=${c.regressions.length}`,
    );
  }
  console.log(kleur.dim(`(${out.evals_run} evals run, replay_id=${out.replay_id})`));
}

function cmdPatches(args: string[]) {
  const sub = args[0];
  const db = openDb(DB_PATH);
  if (sub === "list") {
    const status = getOpt(args, "--status");
    const ps = listPatches(db, { status });
    for (const p of ps) {
      console.log(
        `${kleur.cyan(p.patch_id)}  ${kleur.yellow(p.status.padEnd(8))}  ${p.type.padEnd(18)}  cluster=${p.origin_cluster_id?.slice(-6)}`,
      );
    }
    console.log(kleur.dim(`(${ps.length} patches)`));
    return;
  }
  if (sub === "approve" || sub === "reject") {
    const ids = args.slice(1).filter((a) => !a.startsWith("--"));
    if (ids.length === 0) return die(`usage: nerve patches ${sub} <id> [<id>...]`);
    for (const id of ids) {
      if (!getPatch(db, id)) {
        console.error(kleur.red(`✗ ${id} not found`));
        continue;
      }
      updatePatchStatus(db, id, sub === "approve" ? "live" : "rejected");
      console.log(kleur.green(`✓ ${id} → ${sub === "approve" ? "live" : "rejected"}`));
    }
    return;
  }
  die(`usage: nerve patches list|approve|reject ...`);
}

async function cmdCompile(args: string[]) {
  const file = args[0];
  if (!file) return die("usage: nerve compile <file.json>");
  const db = openDb(DB_PATH);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<TaskEnvelope>;
  const task = parseOrThrow(TaskEnvelope, {
    schema_version: "0.1",
    task_id: raw.task_id ?? newId("tsk"),
    agent_id: raw.agent_id ?? "cli",
    intent: raw.intent ?? "(unspecified)",
    inputs: raw.inputs ?? {},
    modality: raw.modality ?? "text",
    risk_class: raw.risk_class ?? "unknown",
    budget_hint: raw.budget_hint ?? {},
    tools_available: raw.tools_available ?? [],
    context_refs: raw.context_refs ?? [],
    parent_task_id: raw.parent_task_id ?? null,
    created_at: raw.created_at ?? nowIso(),
  });
  const r = compileTask(db, task);
  console.log(JSON.stringify(r, null, 2));
}

function cmdDb() {
  const db = openDb(DB_PATH);
  const c = countTraces(db);
  const snapshot = exportTokenOpsSnapshot(db, { traceLimit: 100_000, benchmarkLimit: 100_000 });
  console.log(JSON.stringify({
    db: DB_PATH,
    ...c,
    clusters: listClusters(db).length,
    patches: listPatches(db).length,
    tokenops_request_traces: snapshot.traces.length,
    tokenops_benchmark_results: snapshot.benchmark_results.length,
  }, null, 2));
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function die(msg: string): never {
  console.error(kleur.red(msg));
  process.exit(2);
}

function persistBenchmarkResults(results: Awaited<ReturnType<typeof replayAll>>): void {
  const db = openDb(DB_PATH);
  const now = Date.now();
  for (const [index, result] of results.entries()) {
    insertTokenOpsBenchmarkResult(db, `cli_${now}_${index}_${result.dataset}`, result);
  }
}

function expandFiles(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a.includes("*")) {
      const dir = resolve(a.replace(/\/?\*.*/, "") || ".");
      const pattern = a.split("/").pop() ?? "*";
      const rx = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        for (const f of readdirSync(dir)) {
          if (rx.test(f)) out.push(resolve(dir, f));
        }
      }
    } else {
      out.push(resolve(a));
    }
  }
  return out;
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

function readVerifierCases(path: string): VerifierEvalCase[] {
  return readFileSync(resolve(path), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as VerifierEvalCase);
}

function judgmentForExpected(expected: VerifierEvalCase["expected"]): string {
  if (expected === "passed") return "PASS: dataset expected pass";
  if (expected === "failed") return "FAIL: dataset expected fail";
  return "UNCERTAIN: dataset expected uncertain";
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(true));
    server.once("listening", () => {
      server.close(() => resolvePort(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

class StaticJudgeProvider implements ModelProvider {
  readonly name = "cli-static-judge";
  private index = 0;
  constructor(private readonly judgments: string[]) {}

  async complete(request: NormalizedRequest): Promise<ModelResponse> {
    const content = this.judgments[this.index++] ?? "UNCERTAIN: no scripted judgment";
    return {
      id: `judge_${this.index}`,
      model: request.requested_model,
      provider: this.name,
      content,
      finish_reason: "stop",
      input_tokens: 1,
      output_tokens: 1,
      latency_ms: 1,
      cost_usd: 0,
    };
  }
}

function __filenameDir(): string {
  // tsx provides import.meta but we're using __dirname-style fallback via require resolution.
  return resolve(process.cwd());
}

main().catch((e) => {
  console.error(kleur.red(e.stack ?? String(e)));
  process.exit(1);
});
