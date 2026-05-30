import type {
  TaskEnvelope,
  ComputePlan,
  ContextPack,
  TeachingProgram,
  Trace,
  EvalCase,
  TeachingObject,
  PatchCandidate,
  VerifierSpec,
} from "@nerve/ir";

export interface NerveClientOpts {
  base_url?: string;
  token?: string;
}

export interface CompileResponse {
  plan: ComputePlan;
  context_pack: ContextPack;
  teaching_program: TeachingProgram | null;
  receipt_id: string;
}

export interface RecordResponse {
  trace_id: string;
  accepted_events: number;
  outcome: Trace["outcome"];
  receipt_id: string;
}

export interface LearnResponse {
  teachings: TeachingObject[];
  patches: PatchCandidate[];
  receipt_id: string;
}

export interface GenerateEvalsResponse {
  evals: EvalCase[];
  receipt_id: string;
}

export interface VerifyResponse {
  passed: boolean;
  results: Array<{ kind: string; passed: boolean; detail: string }>;
  receipt_id: string;
}

export interface ReplayResponse {
  replay_id: string;
  baseline: { pass_rate: number; cost_usd: number; latency_ms_p50: number };
  candidates: Array<{
    patch_id: string;
    pass_rate: number;
    cost_usd: number;
    latency_ms_p50: number;
    delta: { pass_rate: number; cost_usd: number; latency_ms: number };
    regressions: string[];
  }>;
  evals_run: number;
  receipt_id: string;
}

export class NerveClient {
  readonly base_url: string;
  readonly token: string;
  constructor(opts: NerveClientOpts = {}) {
    this.base_url = opts.base_url ?? process.env.NERVE_URL ?? "http://localhost:7777";
    this.token = opts.token ?? process.env.NERVE_TOKEN ?? "";
  }

  private async req<T>(path: string, body: unknown, idempotency?: string): Promise<T> {
    const res = await fetch(`${this.base_url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(idempotency ? { "idempotency-key": idempotency } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`nerve ${path} ${res.status}: ${text}`);
    return JSON.parse(text) as T;
  }

  compileTask(task: TaskEnvelope) {
    return this.req<CompileResponse>("/v1/compile-task", { task }, task.task_id);
  }

  recordTrace(trace: Trace) {
    return this.req<RecordResponse>("/v1/record-trace", { trace }, trace.trace_id);
  }

  generateEvals(input: { cluster_ids?: string[] | null; max_per_cluster?: number }) {
    return this.req<GenerateEvalsResponse>("/v1/generate-evals", input);
  }

  learn(input: { cluster_ids?: string[] | null }) {
    return this.req<LearnResponse>("/v1/learn", input);
  }

  verify(input: {
    plan_id?: string | null;
    verifiers?: VerifierSpec[] | null;
    input: unknown;
    output: unknown;
  }) {
    return this.req<VerifyResponse>("/v1/verify", input);
  }

  replay(input: { patch_ids: string[]; baseline?: string; eval_ids?: string[] | null; sample?: number }) {
    return this.req<ReplayResponse>("/v1/replay", {
      baseline: "current_policy",
      ...input,
    });
  }
}
