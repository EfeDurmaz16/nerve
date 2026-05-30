import type { BenchmarkResult } from "@tokenops/core";

export class ReplayStore {
  private readonly results: BenchmarkResult[] = [];
  add(result: BenchmarkResult): void {
    this.results.push(result);
  }
  list(): BenchmarkResult[] {
    return [...this.results];
  }
}
