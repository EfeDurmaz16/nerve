import type { DB } from "@nerve/store";
import { getTokenOpsCacheEntry, incrementTokenOpsCacheHit, listTokenOpsCacheEntriesByType, upsertTokenOpsCacheEntry } from "@nerve/store";
import { hashJson, type CacheEntry, type NormalizedRequest } from "@tokenops/core";
import { contextBlockFingerprints } from "./context-block-cache.js";

export interface ContextBlockObservation {
  hit: boolean;
  reusedBlocks: string[];
  fingerprints: Record<string, string>;
}

export class SqliteContextBlockCache {
  constructor(private readonly db: DB) {}

  observe(request: NormalizedRequest, ttlMs = 24 * 60 * 60 * 1000): ContextBlockObservation {
    const fingerprints = contextBlockFingerprints(request);
    const reusedBlocks: string[] = [];
    for (const [name, fingerprint] of Object.entries(fingerprints)) {
      const key = contextBlockKey(name, fingerprint);
      const existing = getTokenOpsCacheEntry<{ name: string; fingerprint: string }>(this.db, key);
      if (existing && (!existing.expires_at || Date.parse(existing.expires_at) >= Date.now())) {
        reusedBlocks.push(name);
        incrementTokenOpsCacheHit(this.db, key);
      } else {
        const entry: CacheEntry<{ name: string; fingerprint: string }> = {
          key,
          type: "context_block",
          request_hash: request.normalized_hash,
          response: { name, fingerprint },
          metadata: {
            block_name: name,
            fingerprint,
            user_id: request.user_id ?? null,
            agent_id: request.agent_id ?? null,
          },
          created_at: new Date().toISOString(),
          expires_at: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null,
          hit_count: 0,
          safety_class: "context_safe",
        };
        upsertTokenOpsCacheEntry(this.db, entry);
      }
    }
    return { hit: reusedBlocks.length > 0, reusedBlocks, fingerprints };
  }

  stats() {
    const entries = listTokenOpsCacheEntriesByType<unknown>(this.db, "context_block", 10_000);
    return {
      entries: entries.length,
      hits: entries.reduce((sum, entry) => sum + entry.hit_count, 0),
    };
  }
}

function contextBlockKey(name: string, fingerprint: string): string {
  return ["context", name, hashJson(fingerprint)].join(":");
}
