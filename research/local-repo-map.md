# Nerve — Local Repo Asset Map

Inventory of 8 local repos for reuse in **nerve** (inference compiler for agents). For each: maturity, key primitives, and reuse verdict relative to the core loop **task → compute plan → trace → eval → better plan**.

Verdict legend: **REUSE NOW** (vendor/import code or types) · **REUSE LATER** (good idea, not MVP) · **DO NOT USE** (stale, wrong shape, or scaffold-only).

---

## 1. capsule — `/Users/efebarandurmaz/capsule`

- **Lang/PM:** TypeScript (strict ESM), pnpm workspace, vitest, changesets. Not yet published to npm.
- **Maturity:** Working prototype, well-tested. 15 adapter packages (`adapter-docker`, `adapter-e2b`, `adapter-modal`, `adapter-mock`, `adapter-neon`, `adapter-vercel`, `adapter-cloudflare`, `adapter-fly`, `adapter-ec2`, `adapter-ecs`, `adapter-lambda`, `adapter-kubernetes`, `adapter-cloud-run`, `adapter-azure-container-apps`, `adapter-daytona`), plus `core`, `cli`, `ai`, `preview`, `presets`, `store-jsonl`, `store-sqlite`, `test-utils`.
- **Key files:** `packages/core/src/{contract,types,receipts,policy,capabilities,adapters,stores,artifacts}.ts`; `schemas/capsule-receipt.schema.json`.
- **Primitives that matter for nerve:**
  - **CapabilityMap + SupportLevel** (`native | emulated | unsupported | experimental`) per domain (sandbox/job/service/edge/database/preview/machine). Adapters self-declare; `assertAdapterContract()` enforces consistency. **This is exactly the shape nerve needs for model/provider capability declarations.**
  - **CapsuleReceipt** (canonical receipt schema with id, capabilityPath, supportLevel, durationMs, policy decision, artifacts, sanitized providerOptions, optional signature). Already implements secret redaction (`secretOptionKey` regex), Merkle-friendly metadata sanitization, and `ReceiptSigner` interface.
  - **CapsulePolicy** with network/filesystem/secrets/limits/approvals — pre-execution `evaluatePolicy()` returns a decision recorded into the receipt.
  - **Stores** (`store-jsonl`, `store-sqlite`) for receipt persistence.
  - **adapter-mock** is exactly the pattern nerve needs for replay/canary mode (no real provider calls, deterministic results).
- **Verdict: REUSE NOW.** Receipt schema, policy struct, capability map, and store-sqlite are directly portable to nerve's "compute plan receipt" / trace store. The whole adapter-domain pattern is the right shape for "model adapter with declared support levels" (e.g. structured output: native vs emulated vs unsupported).

---

## 2. agentbox — `/Users/efebarandurmaz/agentbox`

- **Lang/PM:** Rust workspace (edition 2021), Cargo. 6 crates: `agentbox-daemon`, `agentbox-shim`, `agentbox-cli`, `agentbox-policy`, `agentbox-client`, `agentbox-remote-worker`.
- **Maturity:** Working prototype with tests dir, docs, scripts. The shim→daemon→policy→approval→audit loop is validated.
- **Key files:** `crates/agentbox-policy/src/{classify,rules}.rs`; `crates/agentbox-daemon/src/{audit,notify,socket}.rs` + `src/pod/{intent,machine,podman,provider}.rs` + `src/runtime/{agit,approval,bridge,fides,manager,policy,provider,session,workspace,registry}.rs`.
- **Primitives that matter for nerve:**
  - **Three-bucket classifier**: `Bucket::{Allow, Approve, Block}` with `CommandContext` (binary, args, cwd, parent_process, pid) + `PolicyConfig` (workspace, allowed_domains, network_mode, always_allow/block). `classify(ctx, config) -> Classification {bucket, reason, notification_summary}`. **This is the exact verifier-gate shape nerve needs for "is this model call allowed under current task budget/risk?"**
  - **AuditEvent**: schema_version, ULID id, agent_pid, command, cwd, bucket, decision, user_response_ms, **prev_hash + event_hash** (hash-chained), with verification (`AuditVerification`, `AuditViolation`). SQLite-backed via r2d2 pool. **Exactly the trace-ledger primitive nerve needs.**
  - **AgentPod contract** (under daemon/src/pod/) — task-scoped execution cell with workspace, providers, types. Conceptually parallel to nerve's "compute plan execution context."
  - **runtime/agit.rs + runtime/fides.rs** show how to compose with sister projects for audit/identity.
- **Verdict: REUSE NOW (concepts), REUSE LATER (code).** Rust → if nerve is TS, port the Bucket/Classification/AuditEvent shapes 1:1. If nerve is Rust, vendor `agentbox-policy` and the audit module. The three-bucket pattern + hash-chained SQLite audit is the cleanest verifier primitive in the portfolio.

---

## 3. sardis — `/Users/efebarandurmaz/sardis`

- **Lang/PM:** Polyglot monorepo. Python (`packages/sardis`, pyproject) + TypeScript (`packages/sardis-js`, tsup/vitest) + MCP server (`packages/sardis-mcp-server`) + Solidity contracts (`contracts/`, foundry) + Next.js apps (`apps/{api,canvas-site,dashboard,landing}`).
- **Maturity:** Production-ish. Published to PyPI/npm. CI, OpenSSF scorecard, Discord, docs site.
- **Key dirs:** `packages/sardis-js/src/{core,protocol,guardrails,ledger,compliance,chain,checkout,wallet,resources,ucp,webhooks,ai-sdk,langchain,mastra}`; `packages/sardis-mcp-server/src/tools/{mandates,policy}.ts`; `packages/sardis-js/src/resources/mandate-delegation.ts`.
- **Primitives that matter for nerve:**
  - **Policy-before-spend** as a product idea — Sardis enforces signed mandate + deterministic policy + approval + audit packet **before** money moves. Nerve's pitch is the same shape: policy + plan + verification **before** model is called.
  - **Mandate / delegation resource** (`resources/mandate-delegation.ts`) — signed authority scoping what an agent can spend. Reusable mental model: nerve has a "task budget mandate" (max tokens/dollars/latency).
  - **Guardrails + ledger** modules are the gate + trace pattern.
- **Verdict: REUSE LATER.** Sardis is the *thesis precedent* but the code surface is heavily payment-rail-specific (chains, USDC, MPC, x402). For nerve MVP, copy the **architectural pattern** (mandate → policy → execution → signed receipt → audit) but do not import sardis code directly. The MCP server's tool shape (`tools/policy.ts`, `tools/mandates.ts`) is useful as a template for nerve's MCP surface.

---

## 4. agit — `/Users/efebarandurmaz/agit`

- **Lang/PM:** Rust workspace + Python (PyO3 via `python/`) + Node (napi-rs via `crates/agit-node`). pyproject + Cargo.
- **Maturity:** Working, well-documented (ARCHITECTURE.md, due-diligence doc), but reportedly alpha. Three storage backends (SQLite/Postgres/S3).
- **Key files:** `crates/agit-core/src/{repo,objects,refs,state,hash,types,encryption,events,guard,blast_radius,bisect,causal,retention,gc}.rs`; `crates/agit-core/src/storage/{sqlite,postgres,s3}.rs`.
- **Primitives that matter for nerve:**
  - **Content-addressed agent state versioning**: SHA-256 DAG, `Blob`+`Commit` objects, `RefStore` for branches/HEAD, three-way merge for JSON state (`merkle_diff`, `three_way_merge`).
  - **AgentState + StateDiff** — diff and merge agent memory/world_state JSON. Directly usable for "trace diff between two plan executions" or "diff between baseline plan and improved plan after a learned lesson."
  - **GuardChain / GuardContext** — pre-commit gates over state changes.
  - **InMemoryEventBus + AgitEvent** for observing commits.
  - **bisect.rs + causal.rs + blast_radius.rs** — finding which change caused a regression. Maps directly onto nerve's "which lesson injection caused this eval failure?"
- **Verdict: REUSE NOW (for trace branching), REUSE LATER (full DAG).** For MVP nerve probably does not need a full git-like DAG of plans. But the **three-way merge of agent-state JSON** and **bisect over a commit chain** are exactly the right primitives for `failure → eval → better future plan` and for "did the learned lesson actually help?" If nerve is Rust, vendor `agit-core`. If TS, copy the diff/merge algorithm.

---

## 5. fides — `/Users/efebarandurmaz/fides`

- **Lang/PM:** TS monorepo (turbo + pnpm). 11 packages: `core`, `policy`, `guard`, `evidence`, `runtime`, `discovery`, `cli`, `sdk`, `rust-sdk`, `shared`. Plus 7 services (`agentd`, `discovery`, `platform-api`, `policy-engine`, `registry`, `relay`, `trust-graph`).
- **Maturity:** Working prototype with docker-compose, load-tests, examples. README is dense and shipped feature list is real.
- **Key files:** `packages/core/src/{identity,canonical-signer,delegation,agent-card,capability,revocation,passkey,trust-anchor,domain-verifier,session-store}.ts`; `packages/evidence/src/index.ts`; `packages/policy/src/index.ts`.
- **Primitives that matter for nerve:**
  - **EvidenceChain + EvidenceEvent** with hash-chained events (`prevHash`, `hash`), Ed25519 signatures, **buildMerkleRoot()**, `verifyEvidenceChain()`, and **EvidencePrivacy** levels (`public | private | redacted | hash-only`). This is the cleanest TS implementation of an audit trail in the portfolio — and the README explicitly says evidence is a **merge of OAPS EvidenceEvent + AGIT hash-chain semantics**. Free design synthesis already done.
  - **PolicyBundle / PolicyRule / PolicyExpression** with deterministic `evaluatePolicy()` returning `{decision: allow|deny|approve-required|dry-run, explanation, matchedRules}`. Plug-and-play for nerve's plan-validation gate.
  - **CapabilityDescriptor** with risk classification (`critical/high/medium/low`) + **DelegationToken** with `maxActions/maxSpend/allowedContexts/expiresAt`. Exact analogue of "task budget."
  - **canonical-signer.ts** — canonical JSON signing utility.
- **Verdict: REUSE NOW.** If nerve is TS, vendor `@fides/evidence` + `@fides/policy` + `@fides/core/canonical-signer` directly. The whole trust-fabric surface is the right shape for nerve's "signed compute plan receipt" + "signed trace event."

---

## 6. osp — `/Users/efebarandurmaz/osp`

- **Lang/PM:** Polyglot. Rust core (`osp-core/crates/{osp-cli,osp-conformance,osp-crypto,osp-manifest,osp-provider,osp-registry,osp-sdk,osp-vault}`), Go SDK (`osp-sdk-go/`), TS packages (`packages/mcp-server`, `packages/provider-framework`), JSON schemas (10 of them), website, conformance tests, skills.
- **Maturity:** Spec-heavy but with multi-language reference implementations. v1.1-draft.
- **Key files:** `schemas/{service-manifest,provision-request,provision-response,credential-bundle,cost-summary,usage-report,webhook-event,health-response,error-response}.schema.json`; `osp-sdk-go/{canonical,crypto,encryption,provider,resolver,client}.go`.
- **Primitives that matter for nerve:**
  - **ServiceManifest** at `.well-known/osp.json`: provider declares offerings, tiers, pricing, accepted payment methods, capabilities. **Same shape nerve needs for "model provider manifest" — declared capabilities, prices, latencies, structured-output support.**
  - **CostSummary + UsageReport** schemas — already-designed shapes for per-call cost/usage that nerve's budget-aware planner needs to consume.
  - **CredentialBundle** with Ed25519-encrypted credential delivery (`osp-sdk-go/encryption.go` is a clean reference impl).
  - **Provider discovery via `.well-known`** is exactly how nerve should discover model providers in a vendor-neutral way.
- **Verdict: REUSE NOW (schemas), REUSE LATER (full protocol).** Borrow `cost-summary`, `usage-report`, and `service-manifest` schema shapes directly for nerve's "model adapter manifest" and "per-task cost ledger." The full provisioning/credential side is out of scope for nerve MVP.

---

## 7. OAPS — `/Users/efebarandurmaz/OAPS`

- **Lang/PM:** Spec repo (markdown-heavy: MASTER-PLAN.md 100KB, PROTOCOL-GAP-ANALYSIS.md 38KB, SPEC.md, CHARTER.md). 22 foundation schemas, plus bindings, profiles for MCP/A2A/ACP/UCP/x402/MPP/OSP/AP2, reference monorepo, Python ref impl.
- **Maturity:** Specification-stage. Reference implementation exists but charter explicitly says "draft IP posture, single maintainer." Most concrete code lives in `reference/` (aosl-monorepo, oaps-monorepo, oaps-python).
- **Key files:** `schemas/foundation/{intent,task,mandate,delegation,actor,capability,interaction,interaction-context,interaction-transition,task-transition,approval-request,approval-decision,evidence-event,execution-result,handshake,message,challenge}.json`; `schemas/{envelope,intent,execution-request,execution-result,evidence-event,delegation-token,approval-request,approval-decision,capability-card,actor-card}.json`.
- **Primitives that matter for nerve:**
  - **Intent schema** (`intent_id`, `verb`, `object`, `constraints`, `requested_outcome`, `priority`, `deadline`) — **this is essentially nerve's "task" envelope**. Reusable as-is.
  - **ExecutionRequest / ExecutionResult / EvidenceEvent** schemas — generic, transport-neutral shapes. EvidenceEvent already has `prev_event_hash`/`event_hash`/`input_hash`/`output_hash` fields — perfect for trace events.
  - **Mandate / Delegation / ApprovalRequest+Decision** — full pre-execution authority pipeline modeled.
  - **Task + TaskTransition + InteractionTransition** — task lifecycle state machine.
- **Verdict: REUSE NOW (schemas only), DO NOT USE (reference impls).** The foundation JSON schemas are the highest-leverage asset here — copy them into `nerve/schemas/` and align nerve's task/intent/evidence shapes with them. Skip the reference monorepos; they're scaffold-level and the spec is in flux. Fides already imported the best ideas, so use Fides for code, OAPS for schemas.

---

## 8. switchboard — `/Users/efebarandurmaz/switchboard`

- **Lang/PM:** Rust workspace (rust-toolchain pinned). 17 crates: `sb-core`, `sb-cli`, `sb-tui`, `sb-events`, `sb-memory`, `sb-replay`, `sb-policy`, `sb-runtime`, `sb-db`, `sb-agents`, `sb-git`, `sb-gui`, `sb-ipc`, `sb-lsp`, `sb-pty`, `sb-repo`. Homebrew Formula present.
- **Maturity:** Working prototype, GETTING_STARTED.md, install script, multi-platform release binaries.
- **Key files:** `crates/sb-events/src/{types,bus,store}.rs`; `crates/sb-replay/src/{player,export,audit,sharing,compliance}.rs`; `crates/sb-memory/src/{types,store,graph}.rs`; `crates/sb-core/src/{coordination,identity,types,project}.rs` + `sb-core/src/oaps/`.
- **Primitives that matter for nerve:**
  - **Event + EventKind**: rich event type with optional `workspace_id/task_id/session_id/service_id/patch_id/run_id` + arbitrary `data: serde_json::Value` payload. Builder pattern. **Exactly the shape nerve needs for trace events.**
  - **ReplayPlayer** with cursor, rewind, seek, next_event over a `Vec<ReplayEvent>` loaded from SQLite. **Replay-from-trace is a core nerve primitive (replay a past task with new model/plan to evaluate regression).**
  - **sb-memory**: Scope hierarchy (`Global/User/Project/Workspace/Session`), NoteKind (`Fact/Decision/Preference/Action/Reminder`), graph store. **Directly maps to nerve's "lessons store" with scope-targeted injection.**
  - **mark_done contract** (from README): an agent cannot mark a task done without evidence; scanned for `TODO/FIXME/stub` markers. Same shape as nerve's verifier.
  - **sb-core/oaps/** submodule shows switchboard already integrates the OAPS envelope.
- **Verdict: REUSE NOW.** Switchboard has the cleanest **event log + replay + scoped memory** triad in the portfolio. If nerve is Rust, vendor `sb-events`, `sb-replay`, and `sb-memory`. If TS, port these three shapes — they map exactly onto `record-trace` and `inject-lessons-by-scope`.

---

## Top 3 concrete reuse opportunities for the MVP

1. **Capsule's Receipt + Adapter contract → nerve's "ComputePlan + Receipt" core.**
   File: `/Users/efebarandurmaz/capsule/packages/core/src/{receipts.ts, contract.ts, types.ts, policy.ts}` + `/Users/efebarandurmaz/capsule/schemas/capsule-receipt.schema.json`.
   Why: receipts are already canonical, sanitize secrets, support `ReceiptSigner`, persist via `store-sqlite`. The `SupportLevel` × `CapabilityMap` per-adapter pattern is the exact shape for "model provider declares: structured_output=native, tool_calling=emulated, vision=unsupported." This collapses ~2 weeks of design work for `compile-task → execute-plan → write-receipt`.

2. **Switchboard's sb-events + sb-replay + sb-memory → nerve's trace, replay, and lesson store.**
   Files: `/Users/efebarandurmaz/switchboard/crates/sb-events/src/{types.rs, bus.rs, store.rs}`, `/Users/efebarandurmaz/switchboard/crates/sb-replay/src/player.rs`, `/Users/efebarandurmaz/switchboard/crates/sb-memory/src/{types.rs, store.rs}`.
   Why: the `record-trace → replay → eval` half of nerve's loop requires (a) typed events with task/session correlation, (b) deterministic seekable replay from SQLite, (c) scoped notes that can be injected by relevance. All three exist, tested, in one repo.

3. **Fides EvidenceChain + PolicyBundle → nerve's verifier and signed trace.**
   Files: `/Users/efebarandurmaz/fides/packages/evidence/src/index.ts`, `/Users/efebarandurmaz/fides/packages/policy/src/index.ts`, `/Users/efebarandurmaz/fides/packages/core/src/{canonical-signer.ts, delegation.ts, capability.ts}.ts`.
   Why: deterministic policy eval returning `allow/deny/approve-required/dry-run` is exactly the gate nerve needs before executing a compute plan; hash-chained + Merkle-rooted evidence is what makes the trace tamper-evident and replay-verifiable. Plus `DelegationToken` with `maxActions/maxSpend/allowedContexts/expiresAt` is the **task-budget mandate primitive** for free. If nerve is TS, vendor these three packages directly.

Supporting cast for MVP:
- **agentbox's `Bucket` classifier + hash-chained `AuditEvent`** is the cleanest verifier+ledger pair if nerve picks Rust.
- **OAPS foundation schemas** (`intent.json`, `task.json`, `mandate.json`, `evidence-event.json`, `execution-result.json`) should be copied into `nerve/schemas/` as the wire format — they already match Fides' code shape.
- **agit's `three_way_merge` + `bisect`** for "did this learned lesson actually improve plans" — REUSE LATER, post-MVP.
- **OSP's `cost-summary.schema.json` + `usage-report.schema.json`** for budget-aware planning.

---

## Missing primitives nerve needs that none of these provide

1. **Compute-plan IR.** No repo has a "compile a task into a typed plan" intermediate representation: ordered steps with `{model, prompt_template, expected_schema, max_tokens, max_latency_ms, fallback, verifier}`. Capsule has *capability paths* (`sandbox.create`, `job.run`) but no notion of compiling a high-level intent into a multi-step plan. OAPS has Intent but not a Plan. **This is nerve's core invention.**

2. **Lesson-injection algorithm.** sb-memory has scoped notes and a graph store, fides has evidence, agit has commits — but none of them implement "given a new task, retrieve only the lessons whose embedding+scope+failure-signature is most relevant, and inject them into the plan." Retrieval is not built. **Build this; don't reuse.**

3. **Verifier-as-program.** Capsule has `evaluatePolicy()` and agentbox has `classify()`, but both verify *requests* before execution. Nerve needs an **output verifier**: given a model response + expected schema + plan step, produce `{passed, failure_signature, suggested_correction}`. Closest precedent is switchboard's `mark_done` README contract (scan for TODO/FIXME), but no code implements a general typed verifier.

4. **Failure → eval generator.** None of the repos turn a single failure into a reusable benchmark case. agit's bisect is the closest mental model (find the change that caused regression), but there's no `trace + failure → EvalCase { input, expected, scoring }` codegen anywhere. **Build from scratch.**

5. **Token/latency/$ budget arithmetic.** OSP has `cost-summary.schema.json` and Sardis has spend mandates, but neither implements a planner that says "given budget=$0.05 and 3 steps, route step 1 to cheap model, step 2 to mid, step 3 to verifier." **Build a small linear-budget allocator on top of OSP's schemas.**

6. **Provider/model capability registry with empirical priors.** Capsule's `SupportLevel` is declared by adapters statically. Nerve needs **measured** capability: "model X's tool_call success rate on schema Y is 0.83 over last 200 calls." No repo tracks this; it has to emerge from the trace store.
