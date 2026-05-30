import { hashJson } from "@tokenops/core";

export class ToolResultCache {
  private readonly entries = new Map<string, unknown>();
  get(toolName: string, args: unknown, resourceVersion: string): unknown | null {
    return this.entries.get(toolResultKey(toolName, args, resourceVersion)) ?? null;
  }
  set(toolName: string, args: unknown, resourceVersion: string, result: unknown): void {
    this.entries.set(toolResultKey(toolName, args, resourceVersion), result);
  }
  stats() {
    return { entries: this.entries.size };
  }
}

export function toolResultKey(toolName: string, args: unknown, resourceVersion: string): string {
  return ["tool", toolName, resourceVersion, hashJson(args)].join(":");
}
