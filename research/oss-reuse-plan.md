# OSS Reuse Plan — nerve

For each project: **Use directly / Integrate later / Study only / Avoid**, with rationale and interop surface.

## Transport / routing

- **LiteLLM** — **Use directly** as a backend transport for `/compile-task` execution. Avoids us re-implementing 100+ provider adapters. Interop: OpenAI Chat Completions request schema; pass-through `model` strings like `anthropic/claude-opus-4.7`.
- **OpenRouter** — **Integrate later** as one of several pluggable backends. Interop: standard chat-completions + their provider-routing payload (`provider.order`, `provider.allow_fallbacks`, `provider.sort`).
- **Vercel AI Gateway** — **Integrate later** as backend for users already on Vercel; BYOK is interesting because nerve never needs to hold provider keys. Interop: AI SDK provider interface so we appear as a model id like `nerve/<plan-id>`.
- **Cloudflare AI Gateway** — **Study only**. Useful reference for cache + retry semantics at the edge. Not a dependency.
- **Portkey** — **Avoid as a dep, study as a competitor**. Overlapping value prop on guardrails; don't bind to them.
- **Helicone gateway** — **Study only**. Their session model is good reference for how to group traces under a task id.

## Observability / eval (we **must** be interoperable, not replace)

- **Langfuse** — **Use directly** for self-host trace storage in v1; also offer it as an export target. Interop: trace/observation/score data model and OTel ingest ([data model](https://langfuse.com/docs/observability/data-model)). nerve's `/record-trace` writes a Langfuse-compatible payload; `/generate-evals` writes Langfuse `dataset_items` + `scores`.
- **Arize Phoenix / OpenInference** — **Integrate later**. Interop: OpenInference span semantic conventions (LLM, RETRIEVER, TOOL spans). Lets us ride the OTel ecosystem without inventing a schema.
- **LangSmith** — **Study only**. Closed product; mirror their eval-experiment UX patterns but do not depend.
- **Braintrust** — **Study only, target as integration**. Their scorer interface (`Scorer({ name, score: ({ input, output, expected }) => number })`) is the cleanest in the space — adopt the shape for nerve scorers so users can port existing Braintrust evals into `/verify`.

## Agent frameworks (sit beside, never compete)

- **OpenAI Agents SDK** — **Integrate later** as a "nerve provider" adapter. An agent built on Agents SDK should be able to set `model="nerve/auto"` and have nerve compile the plan.
- **LangGraph** — **Integrate later**. Ship a `nerve.LangGraphMiddleware` that intercepts each node's LLM call → calls `/compile-task` → executes. Their checkpoint model is the right abstraction; mirror trace shape into LangGraph checkpoints.
- **Mastra** — **Integrate later**. Same pattern: a model provider plug-in.
- **Vercel AI SDK** — **Use directly** as the first SDK to ship. Implement `LanguageModelV2` so `nerve()` is a drop-in model.
- **CrewAI / AutoGen** — **Study only**.

## Compilation / optimization (closest in spirit — owe them intellectually)

- **DSPy** — **Use directly, with care**. Wrap MIPROv2 / BootstrapFewShot as the engine behind `/learn` for the *offline* compile path. Online compile (`/compile-task`) is our own lighter heuristic + cached plan. Interop: accept a `dspy.Module` definition as one input format for compile targets. **Critical delta to communicate**: DSPy is a Python library researchers run; nerve is an HTTP service agents call. Same theory, opposite ergonomics.
- **Anthropic / OpenAI prompt caching** — **Use directly** as a substrate. nerve's planner is cache-aware: when picking a model+context, it orders blocks so provider prefix caching is maximized. Track `cache_read_input_tokens` / `cache_creation_input_tokens` and feed into the budget model.

## Sandboxes (substrate for `/verify` and `/replay`)

- **E2B** — **Use directly** for v1 verifier runtime. Best DX for Python/JS; templates map to verifier images.
- **Daytona** — **Integrate later**. 90ms cold start + snapshot/fork is what `/replay` needs. If we hit cost or speed walls on E2B, switch.
- **Modal sandboxes** — **Integrate later** for GPU-backed verifiers (e.g., running a small judge model in-sandbox).
- **Avoid** building our own sandbox. That is a 2-year detour.

## Schemas to be interoperable with (the load-bearing list)

1. **OpenAI Chat Completions** request/response — our default agent-facing surface for `/compile-task` execution.
2. **OpenAI Responses API** — for agents already using it.
3. **Anthropic Messages API** — for the same reason.
4. **OpenInference / OTel LLM semantic conventions** — for `/record-trace` ingest.
5. **Langfuse trace/observation/score** — for export.
6. **Braintrust Scorer interface** — for `/verify` and `/generate-evals`.
7. **DSPy `Signature` and `Example`** — for `/learn` inputs.
8. **OpenRouter provider-routing block** — for users who want to override our routing decisions.

If we are wire-compatible with these eight, nerve can be adopted without rewriting anything.
