import type { ModelResponse } from "@tokenops/core";
import { CircuitBreaker, type CircuitSnapshot } from "./circuit-breaker.js";
import { InferenceScheduler, type SchedulerStats } from "./inference-scheduler.js";
import { InFlightCoalescer, type CoalescerStats } from "./inflight-coalescer.js";

export interface InferenceRuntimeOptions {
  maxConcurrent?: number;
  maxQueue?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
}

export interface InferenceRuntimeExecuteInput<T> {
  providerKey: string;
  coalesceKey: string;
  priority?: number;
  run: () => Promise<T>;
}

export interface RuntimeExecution<T = ModelResponse> {
  value: T;
  coalesced: boolean;
  circuit: CircuitSnapshot;
}

export interface RuntimeStats {
  scheduler: SchedulerStats;
  coalescer: CoalescerStats;
  circuits: Record<string, CircuitSnapshot>;
}

export class InferenceRuntime {
  private readonly scheduler: InferenceScheduler;
  private readonly coalescer = new InFlightCoalescer();
  private readonly breaker: CircuitBreaker;

  constructor(opts: InferenceRuntimeOptions = {}) {
    this.scheduler = new InferenceScheduler({ maxConcurrent: opts.maxConcurrent, maxQueue: opts.maxQueue });
    this.breaker = new CircuitBreaker({
      failureThreshold: opts.circuitFailureThreshold,
      cooldownMs: opts.circuitCooldownMs,
    });
  }

  execute<T>(input: InferenceRuntimeExecuteInput<T>): Promise<RuntimeExecution<T>> {
    const circuitBefore = this.breaker.snapshot(input.providerKey);
    this.breaker.beforeExecute(input.providerKey);
    return this.coalescer.run(input.coalesceKey, async () => {
      try {
        const value = await this.scheduler.execute(input.run, { priority: input.priority });
        this.breaker.recordSuccess(input.providerKey);
        return value;
      } catch (error) {
        this.breaker.recordFailure(input.providerKey);
        throw error;
      }
    }).then(({ value, coalesced }) => ({ value, coalesced, circuit: circuitBefore }));
  }

  stats(): RuntimeStats {
    return {
      scheduler: this.scheduler.stats(),
      coalescer: this.coalescer.stats(),
      circuits: this.breaker.all(),
    };
  }
}
