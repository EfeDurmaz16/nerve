export interface CoalescerStats {
  sharedCalls: number;
  coalescedWaiters: number;
  inFlightKeys: number;
}

export class InFlightCoalescer {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private sharedCalls = 0;
  private coalescedWaiters = 0;

  async run<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; coalesced: boolean }> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.coalescedWaiters += 1;
      return { value: await existing, coalesced: true };
    }
    this.sharedCalls += 1;
    const promise = fn();
    this.inFlight.set(key, promise);
    try {
      return { value: await promise, coalesced: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  stats(): CoalescerStats {
    return {
      sharedCalls: this.sharedCalls,
      coalescedWaiters: this.coalescedWaiters,
      inFlightKeys: this.inFlight.size,
    };
  }
}
