import type { DB } from "@nerve/store";
import { getTokenOpsCacheEntry, incrementTokenOpsCacheHit, listTokenOpsCacheEntriesByType, upsertTokenOpsCacheEntry } from "@nerve/store";
import { hashJson, type CacheEntry } from "@tokenops/core";
import { toolResultKey } from "./tool-result-cache.js";

export class SqliteToolResultCache {
  constructor(private readonly db: DB) {}

  get(toolName: string, args: unknown, resourceVersion: string): unknown | null {
    const key = toolResultKey(toolName, args, resourceVersion);
    const entry = getTokenOpsCacheEntry<unknown>(this.db, key);
    if (!entry) return null;
    if (entry.expires_at && Date.parse(entry.expires_at) < Date.now()) return null;
    incrementTokenOpsCacheHit(this.db, key);
    return entry.response;
  }

  set(toolName: string, args: unknown, resourceVersion: string, result: unknown, ttlMs = 60 * 60 * 1000): void {
    const entry: CacheEntry<unknown> = {
      key: toolResultKey(toolName, args, resourceVersion),
      type: "tool_result",
      request_hash: hashJson({ toolName, args, resourceVersion }),
      response: result,
      metadata: {
        tool_name: toolName,
        args_hash: hashJson(args),
        resource_version: resourceVersion,
      },
      created_at: new Date().toISOString(),
      expires_at: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null,
      hit_count: 0,
      safety_class: "tool_safe",
    };
    upsertTokenOpsCacheEntry(this.db, entry);
  }

  stats() {
    const entries = listTokenOpsCacheEntriesByType<unknown>(this.db, "tool_result", 10_000);
    return {
      entries: entries.length,
      hits: entries.reduce((sum, entry) => sum + entry.hit_count, 0),
    };
  }
}
