export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  halfOpenMaxCalls?: number;
  now?: () => number;
}

export interface CircuitSnapshot {
  state: CircuitState;
  failures: number;
  openedUntil?: number;
  halfOpenInFlight: number;
}

export class CircuitOpenError extends Error {
  constructor(readonly key: string, readonly snapshot: CircuitSnapshot) {
    super(`circuit open for ${key}`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly now: () => number;
  private readonly states = new Map<string, CircuitSnapshot>();

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.halfOpenMaxCalls = opts.halfOpenMaxCalls ?? 1;
    this.now = opts.now ?? (() => Date.now());
  }

  canExecute(key: string): boolean {
    const snapshot = this.snapshot(key);
    if (snapshot.state === "closed") return true;
    if (snapshot.state === "half_open") return snapshot.halfOpenInFlight < this.halfOpenMaxCalls;
    return false;
  }

  beforeExecute(key: string): void {
    const snapshot = this.snapshot(key);
    if (snapshot.state === "open") throw new CircuitOpenError(key, snapshot);
    if (snapshot.state === "half_open") {
      if (snapshot.halfOpenInFlight >= this.halfOpenMaxCalls) throw new CircuitOpenError(key, snapshot);
      snapshot.halfOpenInFlight += 1;
      this.states.set(key, snapshot);
    }
  }

  recordSuccess(key: string): void {
    this.states.set(key, { state: "closed", failures: 0, halfOpenInFlight: 0 });
  }

  recordFailure(key: string): void {
    const snapshot = this.snapshot(key);
    const failures = snapshot.failures + 1;
    if (failures >= this.failureThreshold) {
      this.states.set(key, {
        state: "open",
        failures,
        openedUntil: this.now() + this.cooldownMs,
        halfOpenInFlight: 0,
      });
      return;
    }
    this.states.set(key, { state: "closed", failures, halfOpenInFlight: 0 });
  }

  snapshot(key: string): CircuitSnapshot {
    const current = this.states.get(key) ?? { state: "closed" as const, failures: 0, halfOpenInFlight: 0 };
    if (current.state === "open" && (current.openedUntil ?? 0) <= this.now()) {
      const halfOpen = { ...current, state: "half_open" as const, halfOpenInFlight: 0 };
      this.states.set(key, halfOpen);
      return halfOpen;
    }
    return current;
  }

  all(): Record<string, CircuitSnapshot> {
    return Object.fromEntries([...this.states.keys()].map((key) => [key, this.snapshot(key)]));
  }
}
