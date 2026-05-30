import type { DB } from "@nerve/store";
import {
  getTokenOpsCacheEntry,
  incrementTokenOpsCacheHit,
  listTokenOpsCacheEntriesByType,
  upsertTokenOpsCacheEntry,
} from "@nerve/store";
import { hashJson, messageToText, type CacheEntry, type ModelResponse, type NormalizedRequest } from "@tokenops/core";
import { classifyCacheability } from "@tokenops/profiler";
import { isPoisonedSemanticResponse, semanticSimilarity } from "./semantic-cache.js";

export class SqliteSemanticCache {
  constructor(private readonly db: DB, private readonly threshold = 0.72) {}

  get(request: NormalizedRequest): ModelResponse | null {
    if (classifyCacheability(request) !== "semantic_safe") return null;
    const text = semanticText(request);
    const scope = semanticScope(request);
    let best: { score: number; entry: CacheEntry<ModelResponse> } | null = null;
    for (const entry of listTokenOpsCacheEntriesByType<ModelResponse>(this.db, "semantic", 1000)) {
      if (entry.expires_at && Date.parse(entry.expires_at) < Date.now()) continue;
      if (entry.metadata.scope !== scope) continue;
      const entryText = typeof entry.metadata.text === "string" ? entry.metadata.text : "";
      const score = semanticSimilarity(text, entryText);
      if (!best || score > best.score) best = { score, entry };
    }
    if (!best || best.score < this.threshold) return null;
    incrementTokenOpsCacheHit(this.db, best.entry.key);
    return best.entry.response;
  }

  set(request: NormalizedRequest, response: ModelResponse, ttlMs = 60 * 60 * 1000): void {
    if (classifyCacheability(request) !== "semantic_safe") return;
    if (isPoisonedSemanticResponse(response)) return;
    const text = semanticText(request);
    const entry: CacheEntry<ModelResponse> = {
      key: semanticCacheKey(request),
      type: "semantic",
      request_hash: request.normalized_hash,
      response,
      metadata: {
        text,
        scope: semanticScope(request),
        user_id: request.user_id ?? null,
        agent_id: request.agent_id ?? null,
        workload_type: request.workload_type,
      },
      created_at: new Date().toISOString(),
      expires_at: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null,
      hit_count: 0,
      safety_class: "semantic_safe",
    };
    upsertTokenOpsCacheEntry(this.db, entry);
  }

  stats() {
    const entries = listTokenOpsCacheEntriesByType<ModelResponse>(this.db, "semantic", 10_000);
    return {
      entries: entries.length,
      threshold: this.threshold,
      hits: entries.reduce((sum, entry) => sum + entry.hit_count, 0),
    };
  }
}

export function semanticCacheKey(request: NormalizedRequest): string {
  return ["semantic", semanticScope(request), hashJson(semanticText(request))].join(":");
}

function semanticText(request: NormalizedRequest): string {
  return request.messages.map(messageToText).join(" ");
}

function semanticScope(request: NormalizedRequest): string {
  return [request.user_id ?? "public", request.agent_id ?? "agentless", request.workload_type].join(":");
}
