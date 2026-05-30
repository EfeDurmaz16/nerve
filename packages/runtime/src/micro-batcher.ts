export interface MicroBatcherOptions {
  maxBatchSize?: number;
  maxDelayMs?: number;
}

export interface MicroBatchStats {
  maxBatchSize: number;
  maxDelayMs: number;
  queued: number;
  batches: number;
  items: number;
  largestBatch: number;
  averageBatchSize: number;
}

interface PendingItem<I, O> {
  input: I;
  resolve: (value: O) => void;
  reject: (error: unknown) => void;
}

export class MicroBatcher<I, O> {
  private readonly maxBatchSize: number;
  private readonly maxDelayMs: number;
  private readonly queue: Array<PendingItem<I, O>> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private batches = 0;
  private items = 0;
  private largestBatch = 0;

  constructor(
    private readonly handler: (items: I[]) => Promise<O[]>,
    opts: MicroBatcherOptions = {},
  ) {
    this.maxBatchSize = opts.maxBatchSize ?? 8;
    this.maxDelayMs = opts.maxDelayMs ?? 5;
  }

  submit(input: I): Promise<O> {
    return new Promise<O>((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
        return;
      }
      if (!this.timer) this.timer = setTimeout(() => this.flush(), this.maxDelayMs);
    });
  }

  stats(): MicroBatchStats {
    return {
      maxBatchSize: this.maxBatchSize,
      maxDelayMs: this.maxDelayMs,
      queued: this.queue.length,
      batches: this.batches,
      items: this.items,
      largestBatch: this.largestBatch,
      averageBatchSize: this.batches === 0 ? 0 : round2(this.items / this.batches),
    };
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.maxBatchSize);
    this.batches += 1;
    this.items += batch.length;
    this.largestBatch = Math.max(this.largestBatch, batch.length);
    void this.handler(batch.map((item) => item.input)).then(
      (outputs) => {
        if (outputs.length !== batch.length) throw new Error(`micro-batch handler returned ${outputs.length} outputs for ${batch.length} inputs`);
        outputs.forEach((output, index) => batch[index]!.resolve(output));
        if (this.queue.length > 0 && !this.timer) this.timer = setTimeout(() => this.flush(), this.maxDelayMs);
      },
      (error) => {
        batch.forEach((item) => item.reject(error));
        if (this.queue.length > 0 && !this.timer) this.timer = setTimeout(() => this.flush(), this.maxDelayMs);
      },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
