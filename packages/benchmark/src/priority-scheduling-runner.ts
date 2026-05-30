import { InferenceScheduler } from "@tokenops/runtime";

export interface PrioritySchedulingBenchmarkResult {
  executionOrder: string[];
  foregroundStartedBeforeBackground: boolean;
  queuedByPriorityAtPeak: Record<string, number>;
  passed: boolean;
  reason: string;
}

export async function runPrioritySchedulingBenchmark(): Promise<PrioritySchedulingBenchmarkResult> {
  const scheduler = new InferenceScheduler({ maxConcurrent: 1, maxQueue: 8 });
  const executionOrder: string[] = [];
  let release!: () => void;
  const blocker = scheduler.execute(() => new Promise<string>((resolve) => {
    release = () => resolve("blocker");
  }));
  const background1 = scheduler.execute(async () => {
    executionOrder.push("background-1");
    return "background-1";
  }, { priority: -10 });
  const background2 = scheduler.execute(async () => {
    executionOrder.push("background-2");
    return "background-2";
  }, { priority: -10 });
  const foreground = scheduler.execute(async () => {
    executionOrder.push("foreground");
    return "foreground";
  }, { priority: 10 });
  const queuedByPriorityAtPeak = scheduler.stats().queuedByPriority;

  release();
  await Promise.all([blocker, background1, background2, foreground]);
  const foregroundStartedBeforeBackground = executionOrder[0] === "foreground";
  return {
    executionOrder,
    foregroundStartedBeforeBackground,
    queuedByPriorityAtPeak,
    passed: foregroundStartedBeforeBackground,
    reason: foregroundStartedBeforeBackground
      ? "foreground inference with higher priority ran before queued background work"
      : "foreground inference waited behind queued background work",
  };
}
