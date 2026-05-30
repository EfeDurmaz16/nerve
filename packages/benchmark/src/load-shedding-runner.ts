import { InferenceScheduler, QueueShedError, type SchedulerStats } from "@tokenops/runtime";

export interface LoadSheddingBenchmarkResult {
  maxConcurrent: number;
  maxQueue: number;
  foregroundAdmitted: boolean;
  backgroundExecuted: boolean;
  shedBackgroundRequests: number;
  rejectedForegroundRequests: number;
  executionOrder: string[];
  runtime: SchedulerStats;
  passed: boolean;
}

export async function runLoadSheddingBenchmark(): Promise<LoadSheddingBenchmarkResult> {
  const scheduler = new InferenceScheduler({ maxConcurrent: 1, maxQueue: 1 });
  const executionOrder: string[] = [];
  let release!: () => void;
  const blocker = scheduler.execute(() => new Promise<string>((resolve) => {
    release = () => {
      executionOrder.push("blocker");
      resolve("blocker");
    };
  }), { priority: 0 });
  const background = scheduler.execute(async () => {
    executionOrder.push("background");
    return "background";
  }, { priority: -10 });
  const foreground = scheduler.execute(async () => {
    executionOrder.push("foreground");
    return "foreground";
  }, { priority: 100 });

  let shedBackgroundRequests = 0;
  background.catch((error: unknown) => {
    if (error instanceof QueueShedError) shedBackgroundRequests += 1;
  });

  release();
  const foregroundResult = await foreground;
  await blocker;
  await background.catch(() => undefined);
  const runtime = scheduler.stats();
  const foregroundAdmitted = foregroundResult === "foreground";
  const backgroundExecuted = executionOrder.includes("background");
  const rejectedForegroundRequests = foregroundAdmitted ? 0 : 1;

  return {
    maxConcurrent: runtime.maxConcurrent,
    maxQueue: runtime.maxQueue,
    foregroundAdmitted,
    backgroundExecuted,
    shedBackgroundRequests,
    rejectedForegroundRequests,
    executionOrder,
    runtime,
    passed: foregroundAdmitted && !backgroundExecuted && shedBackgroundRequests > 0 && runtime.shed > 0,
  };
}
