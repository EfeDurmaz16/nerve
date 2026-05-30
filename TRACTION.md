# nerve — 30-day traction plan

## Positioning (DO NOT DRIFT)

> "Agents shouldn't hardcode `model="claude-opus-4-7"`. They should HTTP POST `/compile-task` with `{task, budget, context}` and get back a plan — which model, with what cached context, against which verifier — that gets better every week because traces and corrections feed back into the compiler. Like DSPy, but online, agent-facing, and provider-agnostic."

**Never** lead with "save 20% on your LLM bill." That collapses us into the gateway category. Lead with **compile, learn, replay, receipt**. Cost-down is a side effect of plan quality, not the pitch.

## First ICP (do not split focus in week 1)

**AI-native services companies** — accounting, legal, compliance, brokerage, ops-as-a-service. Agents run 50–5,000 LLM calls per task; cost-per-task is a CFO line item.

**Warmest first design partner:** **autonomous coding-agent products** (Devin-shaped / Codex-shaped / Replit-Agent-shaped). Their verifier (the test suite) is free.

## 10 ICPs ranked

| # | ICP | Why |
|---|---|---|
| 1 | AI-native services (acct, legal, ops) | cost-per-task = CFO line item |
| 2 | Autonomous coding agents | verifier is the test suite (free) |
| 3 | Long-horizon research/deep-research agents | heavy context → cache wins |
| 4 | Regulated support agents (health, fintech) | verifier = compliance check |
| 5 | Agent-shaped data extraction at scale | pure cost play |
| 6 | Multi-agent simulation/eval companies | already think in traces |
| 7 | AI SDR / outbound agents | clear conversion metric for /learn |
| 8 | Voice agents | latency-critical, routing under SLO |
| 9 | Browser-using agents | verifier = page state |
| 10 | Generic ChatGPT-wrapper SaaS | lowest priority — no agents yet |

## The offer

**Free failure/compute audit on one real agent workflow.**

- They share 100–1,000 production traces (any format: OpenAI JSONL, Langfuse export, OpenTelemetry spans).
- We return: **failure clusters, regression evals, ≥1 PatchCandidate per cluster, one replay report** showing measurable pass-rate / cost / latency delta.
- Audit is delivered in 48h. Output is a `~/.nerve/` directory they can run locally + a 1-page PDF.
- Paid pilot only if the audit shows ≥0.10 pass-rate improvement or ≥10% cost reduction on the replay.

## Outreach template (founder-to-founder, ~120 words)

Subject: **compile-task instead of model="opus" — quick experiment?**

Hey {name},

I'm building nerve — an inference compiler agents call before they call a model. Instead of hardcoding `model="claude-opus-4-7"`, your agent POSTs `/compile-task` with `{task, budget, context}` and gets back a compute plan (which model, what context, which verifier, when to fall back, what budget). Traces and corrections feed back so the plan gets sharper each week.

Closest spiritual ancestor is DSPy, but online and agent-facing instead of a Python lib for offline metric optimization.

I'm running free 48h audits on real {coding-agent / support-agent / extraction} traces this month. You ship me 100–1,000 traces in any format (OpenAI JSONL, Langfuse export, OTel — I'll wrangle), I send back failure clusters, regression evals, and a replay report. No commitment. Worth 20 minutes of your CTO's time if any of that resonates.

— Efe

## 30-day goals (concrete, measurable)

| Metric | Target |
|---|---|
| Outbound messages sent | 30 |
| Founder/CTO replies | 12 |
| Discovery calls held | 10 |
| Teams who shared traces | 5 |
| Audits delivered | 3 |
| Paid pilots booked | 1 |
| Public demo video shipped | 1 (≤90s, with the replay delta visible) |
| OSS launch | 1 (this repo, public, with examples + demo) |
| Concrete public claim | "Compiled X agent tasks, generated Y evals, identified Z repeated failure clusters across N teams, improved pass-rate by Δ on M workflows." |

## Outreach channel mix (week-by-week)

| Week | Focus | Channels |
|---|---|---|
| 1 | Founder DMs to coding-agent teams (ICP #2). Soft launch repo. | X DMs, GitHub Discussions, founder Slack groups |
| 2 | Cold email to AI-native services CTOs (ICP #1). | Email + LinkedIn (1-1, no automation) |
| 3 | Public demo video; 2nd-tier ICPs (#3-5); apply to YC S26. | X video drop, LinkedIn, YC application |
| 4 | Close 1 paid pilot. Write the post-mortem of the 3 audits. | Direct sales, public retro post |

## What NOT to do this month

- Do NOT build a dashboard. The dashboard is a distraction from "agent-facing".
- Do NOT build a hosted version. Self-host audit is the offer.
- Do NOT add fine-tuning or multi-tenant auth. v0.1 is one process, one DB.
- Do NOT respond to "are you a gateway?" with "kind of." Answer: "No — we tell the agent what to call. Gateways route. We compile."
- Do NOT respond to "are you Langfuse for agents?" with "kind of." Answer: "Langfuse traces for humans. We compile, learn, and replay for agents."
- Do NOT promise a fine-tune or auto-promotion in the demo. Both ship in v0.2 at the earliest.

## Defensibility messaging (for follow-ups and YC)

- **Wire-compatible with incumbents.** We ingest Langfuse/LangSmith/OpenInference, route through OpenRouter/LiteLLM. Switching cost is low — the lock-in is the corrected, eval-backed teaching corpus.
- **Asymmetric data.** Every trace makes the next plan cheaper for *that* customer, not for OpenAI. The teaching corpus + eval suite is the moat — not the routing decision (commodity within 12 months).
- **Receipts.** Every verb call writes a Receipt (verb, inputs_hash, outputs_hash, cost, latency). Audit trail is free, signed-ready for v0.2.
- **Structural conflict-of-interest** with the obvious incumbents: gateways won't build us (it cannibalizes per-token routing margin); observability players won't (no runtime path); agent frameworks won't (they would have to admit they shouldn't ship policy themselves).

## YC S26 framing

Direct hit on three Requests for Startups:
- **Software for Agents** (Aaron Epstein) — first user is an agent, not a human.
- **Inference Chips for Agent Workflows** (Diana Hu) — same demand-side problem solved at the software layer.
- **AI-Native Services** (Gustaf Alströmer) — back-office for AI-native services.

One-liner for the application: *"nerve is the inference compiler agents call before they call a model. Traces and corrections turn into evals and lessons that make the next plan sharper."*

## Top of the funnel (first 30 names — fill in as you go)

> Replace placeholders with actual targets from your network + Apollo enrichment. Do not auto-blast — write each message by hand. Lead with one specific detail about their stack you can only know by reading their docs.

| Co | Person | Role | Channel | Hook |
|---|---|---|---|---|
| {coding-agent #1} | … | CTO / founding eng | X DM | "Saw your `agent.run()` exposes model directly — what if it didn't?" |
| {coding-agent #2} | … | … | … | … |
| {coding-agent #3} | … | … | … | … |
| {AI-native services #1} | … | … | … | "Cost-per-task on your {workflow} must be load-bearing." |
| … | … | … | … | … |
