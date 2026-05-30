# Cache Model

TokenOps implements multiple reuse layers:

- Exact cache: stable normalized request hash plus user/agent isolation.
- Semantic cache: lexical plus deterministic hashed-vector similarity for safe docs/support/static workloads only.
- Prefix cache simulator: estimates stable system/tool/context prefix reuse.
- Tool-result cache: keyed by tool name, argument hash, and resource version.
- Context-block cache: fingerprints system prompts, tool schemas, and metadata context.

Semantic cache is disabled for private, payment, legal, medical, financial, security-sensitive, and code-modification requests.

## Persistence

The local gateway stores TokenOps cache entries in SQLite through `tokenops_cache_entries`.

SQLite-backed stores:

- `SqliteExactCache`
- `SqliteSemanticCache`
- `SqliteToolResultCache`
- `SqliteContextBlockCache`

Each entry records cache key, cache type, request hash, safety class, metadata, payload, expiry, and hit count.

`POST /cache/clear` clears the local TokenOps cache table.

`GET /cache/stats` reports exact, semantic, tool-result, and context cache stats from the gateway runtime. Tool-result cache persistence is available as a package primitive and is exercised in tests; gateway tool execution is still future work because the OpenAI-compatible chat endpoint does not execute tools itself.
