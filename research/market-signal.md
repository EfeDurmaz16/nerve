# Market Signal — nerve

## YC S26 Requests for Startups — direct alignment

Source: [ycombinator.com/rfs](https://www.ycombinator.com/rfs), plus secondary write-ups ([The VC Corner](https://www.thevccorner.com/p/yc-summer-2026-requests-for-startups-ideas), [VC Cafe](https://www.vccafe.com/2026/04/28/requests-for-startups-summer-2026-edition/)).

### 1. "Software for Agents" — Aaron Epstein

> "The next trillion users on the internet won't be people, they'll be AI agents."
>
> "If you're Making Something Agents Want, we'd love to hear from you."

Epstein's premise: human-shaped software (dashboards, forms, click flows) is "slow, inconsistent, and brittle" for agents. Agents need **machine-readable foundations: APIs, MCPs, CLIs.**

**Match for nerve:** every existing inference tool is human-shaped. OpenRouter has a dashboard. Langfuse has a dashboard. Braintrust has a dashboard. The verbs `/compile-task`, `/record-trace`, `/generate-evals`, `/learn`, `/verify`, `/replay` are explicitly an API for an agent caller, not a UI for a human caller. This is the literal RFS.

### 2. "Inference Chips for Agent Workflows" — Diana Hu

> "Agents don't work that way. They loop: calling tools, branching, backtracking, holding context across dozens of steps."
>
> Current GPUs achieve only 30-40% utilization on agent workloads.

Hu is about silicon; nerve is the software layer with the same insight. Agent inference is **bursty, branching, multi-step** — which is exactly why a per-call routing+planning compiler beats a static `model=` constant. Same thesis, different layer.

### 3. "AI-Native Service Companies" — Gustaf Alströmer

> "AI-native companies that don't sell software—they sell the service."

Indirect match: AI-native service companies will be the **highest-volume agent operators** on Earth. They are nerve's natural ICP because their cost-per-task is their margin.

## The wedge framing — agent-facing primitive

The market is crowded with **human-facing platforms**: gateways with dashboards, eval tools with experiment UIs, observability with seat-based pricing. Almost all of them charge a human to look at a chart.

nerve's positioning collapses to one sentence:

> **nerve is an API that agents call before they call a model.**

This avoids head-on collision with:
- **Gateways** — we route *to* them, not against them. We charge for the plan, not the token.
- **Observability** — we *emit* traces in their schema; we don't replace their UI.
- **Eval platforms** — we *generate* evals into their datasets; we don't sell another experiment workbench.
- **Frameworks** — we are a drop-in model provider; we don't ask anyone to migrate.

The unique surface is what nobody else has: **a per-task compile step that turns last week's traces into next week's plans, exposed as an HTTP verb an agent can call by itself.** No human in the loop. No dashboard required. No SDK migration.

## One-line pitch for an agent infra engineer

> "Your agent shouldn't pick a model — it should ask nerve which model, with which context, against which verifier, under which budget, given what we learned from last week's traces. One HTTP call. Bring your own gateway, eval store, and sandbox."

## Why now (2026)

1. YC explicitly funding agent-native infra (above).
2. Provider-side prompt caching ([Anthropic](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching), OpenAI) makes context-aware planning materially cheaper — there is now a real $$ delta between a smart plan and a dumb one.
3. Sandboxes are cheap and fast enough to run as a per-call verifier ([Daytona](https://www.daytona.io/) <90ms start, $0.05/vCPU-hr).
4. OTel/OpenInference standardization means trace ingest is finally a solved interop problem — we don't have to fight a schema war.
5. DSPy proved compilation works; nobody has productized it as a service.

Sources:
- [Y Combinator Requests for Startups](https://www.ycombinator.com/rfs)
- [The VC Corner — YC S26 RFS breakdown](https://www.thevccorner.com/p/yc-summer-2026-requests-for-startups-ideas)
- [VC Cafe — RFS Summer 2026](https://www.vccafe.com/2026/04/28/requests-for-startups-summer-2026-edition/)
- [Anthropic prompt caching](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching)
- [DSPy](https://dspy.ai/)
- [Daytona](https://www.daytona.io/)
