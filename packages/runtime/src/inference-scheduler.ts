export interface InferenceSchedulerOptions {
  maxConcurrent?: number;
  maxQueue?: number;
}

export interface SchedulerStats {
  maxConcurrent: number;
  maxQueue: number;
  inFlight: number;
  queued: number;
  admitted: number;
  rejected: number;
  completed: number;
}

interface QueuedJob<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class QueueFullError extends Error {
  constructor(maxQueue: number) {
    super(`inference queue full (${maxQueue})`);
    this.name = "QueueFullError";
  }
}

export class InferenceScheduler {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private inFlight = 0;
  private admitted = 0;
  private rejected = 0;
  private completed = 0;
  private readonly queue: Array<QueuedJob<unknown>> = [];

  constructor(opts: InferenceSchedulerOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 8;
    this.maxQueue = opts.maxQueue ?? 100;
  }

  execute<T>(run: () => Promise<T>): Promise<T> {
    if (this.inFlight < this.maxConcurrent) {
      return this.start(run);
    }
    if (this.queue.length >= this.maxQueue) {
      this.rejected += 1;
      return Promise.reject(new QueueFullError(this.maxQueue));
    }
    this.admitted += 1;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve: resolve as (value: unknown) => void, reject });
    });
  }

  stats(): SchedulerStats {
    return {
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      inFlight: this.inFlight,
      queued: this.queue.length,
      admitted: this.admitted,
      rejected: this.rejected,
      completed: this.completed,
    };
  }

  private async start<T>(run: () => Promise<T>): Promise<T> {
    this.inFlight += 1;
    this.admitted += 1;
    try {
      return await run();
    } finally {
      this.inFlight -= 1;
      this.completed += 1;
      this.drain();
    }
  }

  private drain(): void {
    while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      void this.start(job.run).then(job.resolve, job.reject);
    }
  }
}
