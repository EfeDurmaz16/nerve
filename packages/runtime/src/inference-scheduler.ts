export interface InferenceSchedulerOptions {
  maxConcurrent?: number;
  maxQueue?: number;
}

export interface SchedulerStats {
  maxConcurrent: number;
  maxQueue: number;
  inFlight: number;
  queued: number;
  queuedByPriority: Record<string, number>;
  admitted: number;
  rejected: number;
  shed: number;
  completed: number;
}

export interface InferenceSchedulerExecuteOptions {
  priority?: number;
}

interface QueuedJob<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  priority: number;
  sequence: number;
}

export class QueueFullError extends Error {
  constructor(maxQueue: number) {
    super(`inference queue full (${maxQueue})`);
    this.name = "QueueFullError";
  }
}

export class QueueShedError extends Error {
  constructor(readonly priority: number) {
    super(`inference queued work shed for higher-priority request (priority ${priority})`);
    this.name = "QueueShedError";
  }
}

export class InferenceScheduler {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private inFlight = 0;
  private admitted = 0;
  private rejected = 0;
  private shed = 0;
  private completed = 0;
  private sequence = 0;
  private readonly queue: Array<QueuedJob<unknown>> = [];

  constructor(opts: InferenceSchedulerOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 8;
    this.maxQueue = opts.maxQueue ?? 100;
  }

  execute<T>(run: () => Promise<T>, opts: InferenceSchedulerExecuteOptions = {}): Promise<T> {
    const priority = normalizePriority(opts.priority);
    if (this.inFlight < this.maxConcurrent) {
      this.admitted += 1;
      return this.start(run);
    }
    if (this.queue.length >= this.maxQueue) {
      const shed = this.shedLowerPriorityJob(priority);
      if (!shed) {
        this.rejected += 1;
        return Promise.reject(new QueueFullError(this.maxQueue));
      }
    }
    this.admitted += 1;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority,
        sequence: this.sequence++,
      });
    });
  }

  stats(): SchedulerStats {
    return {
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      inFlight: this.inFlight,
      queued: this.queue.length,
      queuedByPriority: this.queuedByPriority(),
      admitted: this.admitted,
      rejected: this.rejected,
      shed: this.shed,
      completed: this.completed,
    };
  }

  private async start<T>(run: () => Promise<T>): Promise<T> {
    this.inFlight += 1;
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
      const job = this.takeNext();
      void this.start(job.run).then(job.resolve, job.reject);
    }
  }

  private takeNext(): QueuedJob<unknown> {
    let bestIndex = 0;
    for (let index = 1; index < this.queue.length; index += 1) {
      const current = this.queue[index]!;
      const best = this.queue[bestIndex]!;
      if (current.priority > best.priority || (current.priority === best.priority && current.sequence < best.sequence)) {
        bestIndex = index;
      }
    }
    return this.queue.splice(bestIndex, 1)[0]!;
  }

  private shedLowerPriorityJob(incomingPriority: number): boolean {
    if (this.queue.length === 0) return false;
    let lowestIndex = 0;
    for (let index = 1; index < this.queue.length; index += 1) {
      const current = this.queue[index]!;
      const lowest = this.queue[lowestIndex]!;
      if (current.priority < lowest.priority || (current.priority === lowest.priority && current.sequence > lowest.sequence)) {
        lowestIndex = index;
      }
    }
    const lowest = this.queue[lowestIndex]!;
    if (incomingPriority <= lowest.priority) return false;
    const [removed] = this.queue.splice(lowestIndex, 1);
    this.shed += 1;
    removed!.reject(new QueueShedError(incomingPriority));
    return true;
  }

  private queuedByPriority(): Record<string, number> {
    const byPriority: Record<string, number> = {};
    for (const job of this.queue) {
      const key = String(job.priority);
      byPriority[key] = (byPriority[key] ?? 0) + 1;
    }
    return byPriority;
  }
}

function normalizePriority(priority: number | undefined): number {
  return Number.isFinite(priority) ? Math.trunc(priority!) : 0;
}
