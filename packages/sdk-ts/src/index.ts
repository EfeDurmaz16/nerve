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
import type { BudgetPolicy, OpenAIChatCompletionRequest, RequestTrace } from "@tokenops/core";

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

export interface TokenOpsClientOpts {
  base_url?: string;
  token?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export interface TokenOpsRequestOpts {
  idempotencyKey?: string;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created?: number;
  model?: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; [key: string]: unknown };
    finish_reason: string | null;
  }>;
  usage?: Record<string, unknown>;
  tokenops?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TokenOpsTraceList {
  traces: RequestTrace[];
}

export class TokenOpsClient {
  readonly base_url: string;
  readonly token: string;
  private readonly fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

  constructor(opts: TokenOpsClientOpts = {}) {
    this.base_url = normalizeTokenOpsRoot(
      opts.base_url ?? process.env.TOKENOPS_URL ?? process.env.OPENAI_BASE_URL ?? "http://localhost:8787",
    );
    this.token = opts.token ?? process.env.TOKENOPS_TOKEN ?? process.env.OPENAI_API_KEY ?? "";
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async chatCompletions(
    request: OpenAIChatCompletionRequest,
    opts: TokenOpsRequestOpts = {},
  ): Promise<OpenAIChatCompletionResponse> {
    return this.request<OpenAIChatCompletionResponse>("POST", "/v1/chat/completions", request, opts);
  }

  async chatCompletionsStream(
    request: OpenAIChatCompletionRequest & { stream: true },
    opts: TokenOpsRequestOpts = {},
  ): Promise<string> {
    const res = await this.fetcher(this.url("/v1/chat/completions"), {
      method: "POST",
      headers: this.headers(opts),
      body: JSON.stringify(request),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`tokenops /v1/chat/completions ${res.status}: ${text}`);
    return text;
  }

  stats<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("GET", "/stats");
  }

  cacheStats<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("GET", "/cache/stats");
  }

  budgetStatus<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>("GET", "/budget/status");
  }

  traces(input: { limit?: number } = {}): Promise<TokenOpsTraceList> {
    const search = input.limit === undefined ? "" : `?limit=${encodeURIComponent(String(input.limit))}`;
    return this.request<TokenOpsTraceList>("GET", `/traces${search}`);
  }

  trace(id: string): Promise<RequestTrace> {
    return this.request<RequestTrace>("GET", `/traces/${encodeURIComponent(id)}`);
  }

  policySimulate<T = Record<string, unknown>>(policy: Partial<BudgetPolicy>): Promise<T> {
    return this.request<T>("POST", "/policy/simulate", { policy });
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    opts: TokenOpsRequestOpts = {},
  ): Promise<T> {
    const res = await this.fetcher(this.url(path), {
      method,
      headers: this.headers(opts),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`tokenops ${path} ${res.status}: ${text}`);
    return JSON.parse(text) as T;
  }

  private headers(opts: TokenOpsRequestOpts = {}): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    };
  }

  private url(path: string): string {
    return `${this.base_url}${path}`;
  }
}

function normalizeTokenOpsRoot(input: string): string {
  return input.replace(/\/+$/, "").replace(/\/v1$/, "");
}
