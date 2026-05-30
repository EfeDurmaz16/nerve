# nerve — 90-second X demo script

## Tweet (the post)

> Your agent shouldn't hardcode `model="claude-opus-4-7"`.
>
> It should call **/compile-task** and get back a *plan* — which model, what context, which verifier, what budget, which prior lessons — that gets sharper every week because traces and corrections feed back into the compiler.
>
> ↓ 90-second demo of nerve: the inference compiler for agents.

(attach the video; reply with the GitHub link)

## Video — six beats, ~15s each

### 0:00–0:10 — The problem (text-on-terminal, no voice)

```
# every agent today, somewhere in its codebase:
model = "claude-opus-4-7"

# nerve instead:
const plan = await nerve.compileTask(task)
```

### 0:10–0:25 — Import 50 traces

```
$ nerve import examples/openai-traces/*.jsonl
✓ imported 50 traces
→ mined 3 clusters from 31 failures
   • wrong_output   schema_hallucination  ×14
   • spec_violation missing_join          ×11
   • wrong_output   wrong_agg             ×6
```

### 0:25–0:40 — Learn (cluster → teachings + patches)

```
$ nerve learn
✓ 7 teachings, 3 patches proposed
  pat_…ATFC3T  prompt_patch  cluster=schema_hallucination
  pat_…6S0HVP  prompt_patch  cluster=missing_join
  pat_…PTD62K  prompt_patch  cluster=wrong_agg
```

### 0:40–0:60 — Replay (the proof)

```
$ nerve replay --patch all --sample 50
baseline     pass_rate=0.667  cost=$0.0019  p50=356ms
candidate    pat_ATFC3T  pass_rate=1.000 (+0.333)  regressions=0
candidate    pat_6S0HVP  pass_rate=1.000 (+0.333)  regressions=0
candidate    pat_PTD62K  pass_rate=1.000 (+0.333)  regressions=0
```

(zoom on the green `+0.333` numbers — this is the moment.)

### 0:60–0:80 — Compile a new task, watch lessons appear in the plan

```
$ nerve patches approve pat_ATFC3T pat_6S0HVP pat_PTD62K

$ curl -X POST :7777/v1/compile-task -d @task.json | jq '{
    model: .plan.model.primary,
    teachings: .teaching_program.teachings | length,
    verifiers: [.plan.verifiers[].kind],
    rationale: .plan.rationale
  }'
{
  "model":     "claude-sonnet-4-6",
  "teachings": 5,
  "verifiers": ["schema","exec","llm_judge"],
  "rationale": "…  live_patches=3"
}
```

### 0:80–0:90 — Closing card

```
agent → /compile-task → plan
                          ↓
                    /record-trace
                          ↓
       /verify  ←  /generate-evals  ←  /learn
                          ↓
              better next /compile-task

nerve — the inference compiler for agents.
github.com/EfeDurmaz16/nerve
```

## Reply chain (post immediately after the video)

1. "This is NOT a gateway. Gateways route between providers. nerve compiles tasks *into* the call. Run anything downstream — OpenRouter / LiteLLM / Vercel AI Gateway."

2. "This is NOT Langfuse / LangSmith / Braintrust. Those are human-facing dashboards. nerve is agent-facing HTTP. It returns JSON, not a chart."

3. "Closest spiritual ancestor: DSPy. DSPy compiles offline in Python. nerve compiles online over HTTP, agent-facing, provider-agnostic."

4. "Looking for 3 design partners running real agents in production. Free 48h audit — share 100–1,000 traces in any format (OpenAI JSONL, Langfuse, OTel) and I'll send back clusters + evals + a replay report. DMs open."

5. "github.com/EfeDurmaz16/nerve — `pnpm install && pnpm demo` runs the whole loop locally in ~8 seconds. No API keys needed."

## Recording tips

- Use `asciinema` or a clean terminal recording at 80×24 — not OBS on full screen.
- Mac terminal, dark mode, JetBrains Mono 16pt, prompt simplified to `$ `.
- Pre-seed `~/.nerve/nerve.db` so the import shows ✓ in <2s, not the cold-start latency.
- Zoom on the **green +0.333** at 0:50 — that's the only frame that matters for the share.
- Pin the closing card on screen for 3 full seconds; people screenshot it.
