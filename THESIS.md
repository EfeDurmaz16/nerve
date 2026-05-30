# nerve — Product Thesis (v0.1)

> **nerve is the inference compiler agents call before they call a model.**

## 1. The product

An agent-native HTTP service that turns each task into a **compute plan**: which model, what context, which verifier, when to fall back, what budget to respect, and which prior lessons apply. Production traces and corrections become regression evals and teaching programs that improve future plans. One closed loop on one machine:

```
task   → /compile-task  → ComputePlan (model + context + teachings + verifier + budget + fallback)
exec   → /record-trace  → Trace (events, cost, latency, outcome)
trace  → mine           → FailureCluster
cluster→ /learn         → TeachingObject + PatchCandidate
cluster→ /generate-evals→ EvalCase
candidate × evals → /replay → before/after delta → human approve → live policy
```

## 2. The first user is an agent, not a human

The agent calls `POST /v1/compile-task` *before* it touches a model. The compiler returns JSON, not a dashboard. The human reviews `/v1/patches?status=proposed` once per day — that is the only human surface in v0.1.

## 3. What the agent receives (compute plan)

`primary_model`, `fallback[]`, `temperature`, `max_output_tokens`, `context_pack_id` (with the chunks, scores, reasons), `teaching_program_id` (curated lessons rendered as system prefix / few-shot / verifier config / tool doc), `verifiers[]` (schema | regex | exec | llm_judge), `budget` (target + hard cap), `fallback_policy` (retry_same | escalate_model | degrade_model | ask_human | abort), `cache_policy`, `rationale`.

## 4. What it learns from

`Trace.events` (model_call, tool_call, verifier_run, **correction**, error) submitted via `/record-trace`. Failures cluster by signature → the learner emits typed teachings (correction, misconception, counterexample, prerequisite, test, review_item, consolidation_item, policy, verifier_hint) and patch candidates (prompt_patch, routing_rule, verifier_rule, teaching_program, context_policy, fallback_policy). Patches are gated by `/replay` against the generated eval corpus.

## 5. Explicitly NOT in v0.1

No dashboard. No multi-tenant SaaS. No billing. No gateway proxy (we tell the agent *what* to call; LiteLLM/OpenRouter/Vercel does the calling). No fine-tuning. No auto-promotion of patches. No streaming. No agent framework (no graphs, no nodes, no DSL). No vector DB (`sqlite-vss` only). No prompt marketplace, no model leaderboard, no playground.

## 6. Why this is not a gateway, observability tool, eval IDE, or memory store

| Existing tool | What it does | What nerve adds |
|---|---|---|
| OpenRouter / Helicone / LiteLLM / Portkey / Vercel AI GW | Route a call between providers | Compile a *task* into the call — before routing |
| Langfuse / LangSmith / Braintrust / Phoenix | Trace + experiment workbench for humans | Trace + closed loop emitting machine-callable plans |
| DSPy | Offline compiler for prompts (Python lib) | Online, agent-facing, provider-agnostic, runtime service |
| LangGraph / OpenAI Agents SDK / Mastra | Framework to compose agents | Middleware below the framework — frameworks call us |
| Mem0 / vector DBs | Store memories | Lessons + retrieval policy, scoped to task signature |
| E2B / Daytona / Modal | Sandbox to execute | Substrate we run verifiers on; not what we build |

Every existing tool is **human-facing** with a dashboard, IDE, or experiment workbench priced per seat. **Nothing sits before the model call, at runtime, exposing planning and learning as agent-facing verbs.** The category gap is structural, not crowded.

## 7. Defensibility

The moat is the **accumulated correction history per task type per ICP** — not the routing decision (commodity within 12 months) and not the trace store (commodity already). After 60–90 days of traces, switching to a competitor means throwing away the compiled plans, the eval corpus, and the teaching programs. Routing is the demo; the corrected, eval-backed teaching corpus is the lock-in.

Secondary moats:
- **Wire-compatible with the incumbents.** We ingest Langfuse / LangSmith / OpenInference traces, emit OpenAI-shaped responses; we route through OpenRouter/LiteLLM. We compete on the loop, not the substrate.
- **Receipts.** Every verb call writes a signed-ready Receipt (verb, inputs_hash, outputs_hash, cost, latency). Audit trail is free.
- **Asymmetric data.** Every trace makes the next plan cheaper for *that* customer, not for OpenAI.

## 8. YC S26 fit — "Make Something Agents Want"

Direct fit against three S26 RFS prompts:
- **Software for Agents (Aaron Epstein)** — nerve is software whose first user is an agent.
- **Inference Chips for Agent Workflows (Diana Hu)** — same demand-side problem (per-task compute is wrong shape), solved at the software layer instead of silicon.
- **AI-Native Services (Gustaf Alströmer)** — nerve is the back-office for AI-native services; cost-per-task is the line item we move.

Why this isn't a feature of an existing player: gateways won't build it (it cannibalizes per-token routing margin); observability players won't build it (no runtime path); agent frameworks won't build it (they would have to admit they shouldn't ship policy themselves). The structural conflict-of-interest creates the seam.

## 9. First ICP

**AI-native services companies** running 50–5,000-call agents in production where cost-per-task and quality-per-task are CFO-visible KPIs. **First design partner = autonomous coding-agent products** (Devin/Codex/Replit-Agent-shaped), because their verifier (the test suite) is free.

## 10. Stack decision

**TypeScript + Zod + Fastify + better-sqlite3 + sqlite-vss + pnpm workspace.** Rationale:
- The agent-infra ecosystem (Vercel AI SDK, Mastra, OpenAI Agents SDK TS, Langfuse SDK, OpenInference) is TS-first.
- The IR design (discriminated unions, branded IDs) maps cleanly to Zod.
- One process, one SQLite file in v0.1 — replaces Postgres/Redis/queue at this scale.
- We can vendor design ideas from `capsule` (TS — receipts, capability map, sqlite store), `fides` (TS — evidence chain, policy bundle, delegation token), and port `switchboard` (Rust — events/replay/memory) shapes into TS modules.

Python (DSPy compatibility) is the obvious v0.2 surface — we will ship a Python SDK that emits/consumes the same IR.

## 11. Demo (90 seconds)

```bash
nerve init && nerve serve &
nerve import examples/openai-traces/*.jsonl       # 50 failing traces → 3 clusters
nerve learn --all                                  # teachings + patch candidates
nerve evals gen --all                              # EvalCases per cluster
nerve replay --patch all --evals all --sample 30   # baseline vs candidate delta
nerve patches approve p_001 p_002 p_003
curl -X POST :7777/v1/compile-task -d @examples/sdk-demo/task.json
# → ComputePlan with the 3 teachings + verifier from the approved patches
```

The reviewer sees: failures-in, plan-with-teachings-out, measurable delta, receipt at each step.

## 12. Working name

`nerve` — placeholder. Final naming after v0.1 ships. Alternatives to consider: `Compileragent`, `Plansmith`, `Conduit`, `Synapse` (taken), `Compute Plan`, `Brief`.

## 13. Risks

- **Crowded perception.** "Yet another LLM tool" is the default reaction; framing as *compiler*, not gateway/eval/observability, is load-bearing every conversation.
- **Cold-start data.** A new customer's first 100 tasks have no teachings — `/compile-task` quality is bounded by the model selector + retrieval. We ship deterministic baselines so day-1 value is non-zero.
- **Verifier quality.** `llm_judge` is the fallback grader; deterministic graders (exec, schema, regex) are the real product. ICP #2 (coding agents) is the warmest path because their verifier is the test suite.
- **Provider drift.** OpenAI/Anthropic ship new model IDs and prompt-cache semantics monthly. Model selector tables must be cheap to update — they live in `packages/planner/src/model_select.ts` as plain data.
