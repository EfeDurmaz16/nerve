import { describe, expect, it } from "vitest";
import { BackgroundTaskQueue, CircuitBreaker, CircuitOpenError, InferenceRuntime, InferenceScheduler, MicroBatcher, QueueFullError } from "./src/index.js";

describe("TokenOps inference runtime", () => {
  it("opens circuit after repeated provider failures and half-opens after cooldown", () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: () => now });
    breaker.beforeExecute("groq");
    breaker.recordFailure("groq");
    expect(breaker.canExecute("groq")).toBe(true);
    breaker.recordFailure("groq");
    expect(breaker.canExecute("groq")).toBe(false);
    expect(() => breaker.beforeExecute("groq")).toThrow(CircuitOpenError);
    now = 101;
    expect(breaker.snapshot("groq").state).toBe("half_open");
    expect(breaker.canExecute("groq")).toBe(true);
    breaker.recordSuccess("groq");
    expect(breaker.snapshot("groq").state).toBe("closed");
  });

  it("limits concurrent inference and rejects when the queue is full", async () => {
    const scheduler = new InferenceScheduler({ maxConcurrent: 1, maxQueue: 1 });
    let release!: () => void;
    const slow = scheduler.execute(() => new Promise<string>((resolve) => {
      release = () => resolve("slow");
    }));
    const queued = scheduler.execute(async () => "queued");
    await expect(scheduler.execute(async () => "rejected")).rejects.toThrow(QueueFullError);
    expect(scheduler.stats()).toMatchObject({ inFlight: 1, queued: 1, rejected: 1 });
    release();
    await expect(slow).resolves.toBe("slow");
    await expect(queued).resolves.toBe("queued");
  });

  it("runs higher-priority queued inference before lower-priority queued work", async () => {
    const scheduler = new InferenceScheduler({ maxConcurrent: 1, maxQueue: 4 });
    const order: string[] = [];
    let release!: () => void;
    const slow = scheduler.execute(() => new Promise<string>((resolve) => {
      release = () => {
        order.push("slow");
        resolve("slow");
      };
    }));
    const low = scheduler.execute(async () => {
      order.push("low");
      return "low";
    }, { priority: 0 });
    const high = scheduler.execute(async () => {
      order.push("high");
      return "high";
    }, { priority: 10 });

    release();
    await expect(Promise.all([slow, low, high])).resolves.toEqual(["slow", "low", "high"]);
    expect(order).toEqual(["slow", "high", "low"]);
    expect(scheduler.stats().queuedByPriority).toEqual({});
  });

  it("coalesces identical in-flight inference work", async () => {
    const runtime = new InferenceRuntime({ maxConcurrent: 4 });
    let calls = 0;
    let release!: () => void;
    const run = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = () => resolve("shared");
      });
    };
    const first = runtime.execute({ providerKey: "mock", coalesceKey: "same", run });
    const second = runtime.execute({ providerKey: "mock", coalesceKey: "same", run });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a.coalesced).toBe(false);
    expect(b.coalesced).toBe(true);
    expect(runtime.stats().coalescer.coalescedWaiters).toBe(1);
  });

  it("groups requests into bounded micro-batches", async () => {
    const flushedSizes: number[] = [];
    const batcher = new MicroBatcher<number, string>(async (items) => {
      flushedSizes.push(items.length);
      return items.map((item) => `out-${item}`);
    }, { maxBatchSize: 3, maxDelayMs: 50 });
    const outputs = await Promise.all([
      batcher.submit(1),
      batcher.submit(2),
      batcher.submit(3),
      batcher.submit(4),
      batcher.submit(5),
      batcher.submit(6),
    ]);
    expect(outputs).toEqual(["out-1", "out-2", "out-3", "out-4", "out-5", "out-6"]);
    expect(flushedSizes).toEqual([3, 3]);
    expect(batcher.stats()).toMatchObject({ batches: 2, items: 6, largestBatch: 3, averageBatchSize: 3 });
  });

  it("executes background tasks with stats and priority", async () => {
    const queue = new BackgroundTaskQueue({ maxConcurrent: 1, maxQueue: 4 });
    const order: string[] = [];
    let release!: () => void;
    queue.enqueue({
      task: "evaluate_quality",
      requestId: "req_blocker",
      priority: 0,
      run: () => new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    });
    queue.enqueue({
      task: "compress_trace",
      requestId: "req_bg",
      priority: -10,
      run: async () => { order.push("compress_trace"); },
    });
    queue.enqueue({
      task: "verify_cached_answer",
      requestId: "req_fg",
      priority: 10,
      run: async () => { order.push("verify_cached_answer"); },
    });

    release();
    await queue.drain();

    expect(order).toEqual(["verify_cached_answer", "compress_trace"]);
    expect(queue.stats()).toMatchObject({
      total: 3,
      completed: 3,
      failed: 0,
      completedByTask: { verify_cached_answer: 1, compress_trace: 1, evaluate_quality: 1 },
    });
  });
});
