import { MicroBatcher, type MicroBatchStats } from "@tokenops/runtime";

export interface BatchBenchmarkOptions {
  requests?: number;
  batchSize?: number;
  batchWindowMs?: number;
  perBatchOverheadMs?: number;
  perItemLatencyMs?: number;
}

export interface BatchBenchmarkResult {
  requests: number;
  batchSize: number;
  batchWindowMs: number;
  perBatchOverheadMs: number;
  perItemLatencyMs: number;
  baselineWallTimeMs: number;
  batchedWallTimeMs: number;
  estimatedLatencyReduction: number;
  batches: number;
  largestBatch: number;
  averageBatchSize: number;
  runtime: MicroBatchStats;
}

export async function runBatchBenchmark(opts: BatchBenchmarkOptions = {}): Promise<BatchBenchmarkResult> {
  const requests = opts.requests ?? 32;
  const batchSize = opts.batchSize ?? 8;
  const batchWindowMs = opts.batchWindowMs ?? 5;
  const perBatchOverheadMs = opts.perBatchOverheadMs ?? 20;
  const perItemLatencyMs = opts.perItemLatencyMs ?? 2;
  const baselineWallTimeMs = requests * (perBatchOverheadMs + perItemLatencyMs);
  const started = Date.now();
  const batcher = new MicroBatcher<number, string>(async (items) => {
    await sleep(perBatchOverheadMs + perItemLatencyMs * items.length);
    return items.map((item) => `ok-${item}`);
  }, { maxBatchSize: batchSize, maxDelayMs: batchWindowMs });

  await Promise.all(Array.from({ length: requests }, (_, index) => batcher.submit(index)));
  const batchedWallTimeMs = Date.now() - started;
  const stats = batcher.stats();
  return {
    requests,
    batchSize,
    batchWindowMs,
    perBatchOverheadMs,
    perItemLatencyMs,
    baselineWallTimeMs,
    batchedWallTimeMs,
    estimatedLatencyReduction: round4(baselineWallTimeMs === 0 ? 0 : (baselineWallTimeMs - batchedWallTimeMs) / baselineWallTimeMs),
    batches: stats.batches,
    largestBatch: stats.largestBatch,
    averageBatchSize: stats.averageBatchSize,
    runtime: stats,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
