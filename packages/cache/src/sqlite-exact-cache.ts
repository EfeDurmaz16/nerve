import type { DB } from "@nerve/store";
import {
  clearTokenOpsCache,
  getTokenOpsCacheEntry,
  incrementTokenOpsCacheHit,
  listTokenOpsCacheEntriesByType,
  upsertTokenOpsCacheEntry,
} from "@nerve/store";
import type { CacheEntry, ModelResponse, NormalizedRequest } from "@tokenops/core";
import { exactCacheKey } from "./exact-cache.js";

export class SqliteExactCache {
  constructor(private readonly db: DB) {}

  get(request: NormalizedRequest): ModelResponse | null {
    const key = exactCacheKey(request);
    const entry = getTokenOpsCacheEntry<ModelResponse>(this.db, key);
    if (!entry) return null;
    if (entry.expires_at && Date.parse(entry.expires_at) < Date.now()) return null;
    incrementTokenOpsCacheHit(this.db, key);
    return entry.response;
  }

  set(request: NormalizedRequest, response: ModelResponse, ttlMs = 60 * 60 * 1000): void {
    const entry: CacheEntry<ModelResponse> = {
      key: exactCacheKey(request),
      type: "exact",
      request_hash: request.normalized_hash,
      response,
      metadata: { user_id: request.user_id ?? null, agent_id: request.agent_id ?? null, model: request.requested_model },
      created_at: new Date().toISOString(),
      expires_at: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null,
      hit_count: 0,
      safety_class: "exact_safe",
    };
    upsertTokenOpsCacheEntry(this.db, entry);
  }

  clear(): void {
    clearTokenOpsCache(this.db);
  }

  stats() {
    const entries = listTokenOpsCacheEntriesByType<ModelResponse>(this.db, "exact", 10_000);
    return {
      entries: entries.length,
      exact: entries.length,
      hits: entries.reduce((sum, entry) => sum + entry.hit_count, 0),
      byType: { exact: entries.length },
    };
  }
}
