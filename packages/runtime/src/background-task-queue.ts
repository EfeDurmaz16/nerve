import type { BackgroundTask } from "@tokenops/core";
import { InferenceScheduler, QueueFullError, type SchedulerStats } from "./inference-scheduler.js";

export interface BackgroundTaskQueueOptions {
  maxConcurrent?: number;
  maxQueue?: number;
}

export interface EnqueueBackgroundTaskInput {
  task: BackgroundTask;
  requestId: string;
  priority?: number;
  run: () => Promise<void>;
}

export interface BackgroundTaskRecord {
  id: string;
  task: BackgroundTask;
  requestId: string;
  priority: number;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
}

export interface BackgroundTaskQueueStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  queuedByTask: Partial<Record<BackgroundTask, number>>;
  runningByTask: Partial<Record<BackgroundTask, number>>;
  completedByTask: Partial<Record<BackgroundTask, number>>;
  failedByTask: Partial<Record<BackgroundTask, number>>;
  scheduler: SchedulerStats;
}

export class BackgroundTaskQueue {
  private readonly scheduler: InferenceScheduler;
  private readonly records = new Map<string, BackgroundTaskRecord>();
  private readonly pending = new Set<Promise<void>>();
  private sequence = 0;

  constructor(opts: BackgroundTaskQueueOptions = {}) {
    this.scheduler = new InferenceScheduler({
      maxConcurrent: opts.maxConcurrent ?? 2,
      maxQueue: opts.maxQueue ?? 100,
    });
  }

  enqueue(input: EnqueueBackgroundTaskInput): string {
    const priority = normalizePriority(input.priority);
    const id = `bg_${++this.sequence}`;
    const record: BackgroundTaskRecord = {
      id,
      task: input.task,
      requestId: input.requestId,
      priority,
      status: "queued",
    };
    this.records.set(id, record);

    const pending = this.scheduler.execute(async () => {
      record.status = "running";
      try {
        await input.run();
        record.status = "completed";
      } catch (error) {
        record.status = "failed";
        record.error = (error as Error).message;
      }
    }, { priority }).catch((error) => {
      record.status = "failed";
      record.error = error instanceof QueueFullError ? error.message : (error as Error).message;
    });
    this.pending.add(pending);
    pending.finally(() => this.pending.delete(pending));
    return id;
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  get(id: string): BackgroundTaskRecord | null {
    return this.records.get(id) ?? null;
  }

  stats(): BackgroundTaskQueueStats {
    const records = [...this.records.values()];
    return {
      total: records.length,
      queued: countStatus(records, "queued"),
      running: countStatus(records, "running"),
      completed: countStatus(records, "completed"),
      failed: countStatus(records, "failed"),
      queuedByTask: countByTask(records, "queued"),
      runningByTask: countByTask(records, "running"),
      completedByTask: countByTask(records, "completed"),
      failedByTask: countByTask(records, "failed"),
      scheduler: this.scheduler.stats(),
    };
  }
}

function countStatus(records: BackgroundTaskRecord[], status: BackgroundTaskRecord["status"]): number {
  return records.filter((record) => record.status === status).length;
}

function countByTask(
  records: BackgroundTaskRecord[],
  status: BackgroundTaskRecord["status"],
): Partial<Record<BackgroundTask, number>> {
  const counts: Partial<Record<BackgroundTask, number>> = {};
  for (const record of records) {
    if (record.status !== status) continue;
    counts[record.task] = (counts[record.task] ?? 0) + 1;
  }
  return counts;
}

function normalizePriority(priority: number | undefined): number {
  return Number.isFinite(priority) ? Math.trunc(priority!) : 0;
}
