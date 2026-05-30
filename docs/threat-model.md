# Threat Model

Primary risks:

- semantic cache poisoning
- wrong cache hit
- prompt injection into cached content
- cross-user leakage
- stale tool result
- provider key leakage
- over-aggressive downgrade
- benchmark gaming
- misleading cost estimates

Current controls:

- exact cache includes user and agent isolation in the key
- semantic cache is disabled for risky/private workloads
- tool-result cache requires resource version
- provider adapters fail without echoing secret values
- trace store includes a basic redaction hook for bearer tokens and `sk-*` keys
- budget blocks are explicit and explainable

Known gaps:

- semantic/tool/context caches remain in-memory for the TokenOps gateway MVP
- redaction is basic and should become configurable
- real provider adapters need request/response secret audits before production use
- semantic cache uses lexical similarity, not embeddings plus eval-backed safety
