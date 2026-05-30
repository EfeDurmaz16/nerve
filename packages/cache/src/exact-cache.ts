import type { CacheEntry, ModelResponse, NormalizedRequest } from "@tokenops/core";

export class ExactCache {
  private readonly entries = new Map<string, CacheEntry<ModelResponse>>();

  get(request: NormalizedRequest): ModelResponse | null {
    const key = exactCacheKey(request);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires_at && Date.parse(entry.expires_at) < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    entry.hit_count += 1;
    return entry.response;
  }

  set(request: NormalizedRequest, response: ModelResponse, ttlMs = 60 * 60 * 1000): void {
    const key = exactCacheKey(request);
    this.entries.set(key, {
      key,
      type: "exact",
      request_hash: request.normalized_hash,
      response,
      metadata: { user_id: request.user_id ?? null, agent_id: request.agent_id ?? null, model: request.requested_model },
      created_at: new Date().toISOString(),
      expires_at: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null,
      hit_count: 0,
      safety_class: "exact_safe",
    });
  }

  clear(): void {
    this.entries.clear();
  }

  stats() {
    return { entries: this.entries.size, exact: this.entries.size, hits: [...this.entries.values()].reduce((s, e) => s + e.hit_count, 0) };
  }
}

export function exactCacheKey(request: NormalizedRequest): string {
  return ["exact", request.user_id ?? "anon", request.agent_id ?? "agentless", request.normalized_hash].join(":");
}
