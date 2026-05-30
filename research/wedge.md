# Wedge — nerve

## The single sharpest wedge

**ICP #1: teams running high-volume autonomous agents in production where cost-per-task and quality-per-task are both KPIs they get paged on.** Concretely: AI-native services companies and coding/research agent products where a single agent makes 50–5,000 LLM calls per task and operators already feel the pain of (a) picking models per step, (b) catching regressions, (c) blowing budgets.

The opening verb is **`/compile-task`**. Everything else (`/record-trace`, `/generate-evals`, `/learn`, `/verify`, `/replay`) is the flywheel that makes `/compile-task` get smarter. We sell the first hit on cost+latency, then the loop locks them in.

## 10 candidate ICPs, ranked

1. **AI-native services companies** (YC RFS #3) — accounting, legal, compliance, brokerage. Margin = cost-per-task. They will pay for any honest 20% reduction.
2. **Autonomous coding agent products** (Devin-shaped, Codex-shaped, Replit-Agent-shaped). 1k+ calls per task, mix of cheap+expensive models, verifier already exists (the test suite).
3. **Long-horizon research/deep-research agents.** Heavy context, expensive context, obvious win from semantic plan cache.
4. **Customer-support agents in regulated verticals** (health, fintech) where verifier = compliance check.
5. **Agent-shaped data extraction at scale** (parse N million docs). Pure cost play.
6. **Multi-agent simulation / eval companies.** Already think in traces.
7. **AI SDR / outbound agents** (Clay/Apollo-shaped). High volume, clear conversion metric for `/learn`.
8. **Voice agents** (latency-critical; routing under SLO).
9. **Browser-using agents.** Verifier = page state.
10. **Generic ChatGPT-wrapper SaaS.** Lowest priority — they don't have agents yet.

ICP #1 wins because cost-per-task is a CFO-visible line item and the loop (`/record-trace` → `/learn` → better `/compile-task`) shows weekly improvement on the line item. ICP #2 is the warmest first design partner because their verifier is free.

## Two-sentence pitch an agent infra eng forwards to their CTO

> Your agent shouldn't hardcode `model="claude-opus-4.7"`. It should HTTP POST `/compile-task` with `{task, budget, context}` and get back a plan — which model, with what cached context, against which verifier — that gets better every week because the traces and corrections feed back into the compiler. Like DSPy, but online, agent-facing, and provider-agnostic.

## What NOT to build

- **Not a dashboard.** No charts UI in v1. A read API and Grafana/Langfuse export is enough.
- **Not a gateway.** We do not terminate provider keys, do not bill tokens, do not mark up. We tell the agent *what* to call; the agent (or LiteLLM/OpenRouter/Vercel) does the calling.
- **Not an eval IDE.** No Braintrust-style experiment workbench. `/generate-evals` outputs JSON; humans use Braintrust/Langfuse to look at it.
- **Not an agent framework.** No graphs, no nodes, no DSL. We are middleware.
- **Not a sandbox.** E2B/Daytona/Modal are the substrate.
- **Not a vector DB.** Memory is a thin pointer into whatever store the user already has.
- **No prompt marketplace, no model leaderboard, no chat UI, no playground.** All distractions.
- **No fine-tuning service.** `/learn` produces prompts and few-shot exemplars in v1; a hosted fine-tune comes only after we see real pull.
- **No multi-tenant LLM hosting.** Ever.

## The defensible loop

```
agent → /compile-task → plan → execute (via any gateway)
                                    ↓
                              /record-trace
                                    ↓
                  /verify  ←  /generate-evals  ←  /learn
                                    ↓
                          better next /compile-task
```

The compiler gets smarter with usage. After 90 days of traces, switching to a competitor means throwing away the compiled plans, the verifiers, and the eval corpus. That is the moat — not the routing decision, the **accumulated correction history** per ICP per task type.

## The one-line tagline

> **nerve: the inference compiler agents call before they call a model.**
