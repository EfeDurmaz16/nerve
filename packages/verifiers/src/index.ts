import type { VerifierSpec } from "@nerve/ir";

export interface VerifierResult {
  kind: string;
  passed: boolean;
  detail: string;
}

export type VerifierFn = (
  input: unknown,
  output: unknown,
  config: Record<string, unknown>,
) => Promise<VerifierResult> | VerifierResult;

// Named exec predicates registered at startup. Avoids dynamic code eval.
const execPredicates: Record<string, (input: unknown, output: unknown, config: Record<string, unknown>) => { passed: boolean; detail?: string }> = {
  // Built-in: "json_keys" — output must include every key in config.required.
  json_keys: (_i, output, config) => {
    const required = Array.isArray(config.required) ? (config.required as string[]) : [];
    if (typeof output !== "object" || output === null)
      return { passed: required.length === 0, detail: "output not object" };
    const missing = required.filter((k) => !(k in (output as Record<string, unknown>)));
    return { passed: missing.length === 0, detail: missing.length === 0 ? "ok" : `missing:${missing.join(",")}` };
  },
  // Built-in: "sql_must_contain" — SQL output string must contain each token (case-insensitive).
  sql_must_contain: (_i, output, config) => {
    const tokens = Array.isArray(config.tokens) ? (config.tokens as string[]) : [];
    const text = String(output ?? "").toLowerCase();
    const missing = tokens.filter((t) => !text.includes(t.toLowerCase()));
    return { passed: missing.length === 0, detail: missing.length === 0 ? "ok" : `missing:${missing.join(",")}` };
  },
  // Built-in: "sql_must_not_contain" — fail if any banned token appears.
  sql_must_not_contain: (_i, output, config) => {
    const banned = Array.isArray(config.tokens) ? (config.tokens as string[]) : [];
    const text = String(output ?? "").toLowerCase();
    const hit = banned.filter((t) => text.includes(t.toLowerCase()));
    return { passed: hit.length === 0, detail: hit.length === 0 ? "ok" : `banned:${hit.join(",")}` };
  },
};

export function registerExecPredicate(name: string, fn: (typeof execPredicates)[string]): void {
  execPredicates[name] = fn;
}

const verifiers: Record<string, VerifierFn> = {
  schema: (_, output, config) => {
    const required = Array.isArray(config.required) ? (config.required as string[]) : [];
    if (typeof output !== "object" || output === null)
      return { kind: "schema", passed: required.length === 0, detail: "output not object" };
    const missing = required.filter((k) => !(k in (output as Record<string, unknown>)));
    return {
      kind: "schema",
      passed: missing.length === 0,
      detail: missing.length === 0 ? "all fields present" : `missing: ${missing.join(", ")}`,
    };
  },

  regex: (_, output, config) => {
    const pattern = String(config.pattern ?? "");
    const flags = String(config.flags ?? "");
    const negate = Boolean(config.negate ?? false);
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const ok = new RegExp(pattern, flags).test(text);
    const passed = negate ? !ok : ok;
    return {
      kind: "regex",
      passed,
      detail: `pattern=/${pattern}/${flags} matched=${ok} negate=${negate}`,
    };
  },

  exec: (input, output, config) => {
    const predicate = String(config.predicate ?? "");
    const fn = execPredicates[predicate];
    if (!fn) return { kind: "exec", passed: false, detail: `unknown predicate: ${predicate}` };
    try {
      const r = fn(input, output, config);
      return { kind: "exec", passed: r.passed, detail: r.detail ?? (r.passed ? "ok" : "fail") };
    } catch (e) {
      return { kind: "exec", passed: false, detail: `exec_error: ${(e as Error).message}` };
    }
  },

  llm_judge: (_, output, config) => {
    // v0.1 heuristic stub: passes if output contains all `must_include` substrings and none of `must_not_include`.
    // Real model judge slots in here in v0.2 (interface preserved).
    const must = Array.isArray(config.must_include) ? (config.must_include as string[]) : [];
    const mustNot = Array.isArray(config.must_not_include) ? (config.must_not_include as string[]) : [];
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const missing = must.filter((s) => !text.toLowerCase().includes(s.toLowerCase()));
    const banned = mustNot.filter((s) => text.toLowerCase().includes(s.toLowerCase()));
    const passed = missing.length === 0 && banned.length === 0;
    return {
      kind: "llm_judge",
      passed,
      detail: passed
        ? "heuristic judge: ok"
        : `missing=[${missing.join(",")}] banned=[${banned.join(",")}]`,
    };
  },

  custom: () => ({ kind: "custom", passed: true, detail: "custom verifier not configured" }),
};

export async function runVerifiers(
  input: unknown,
  output: unknown,
  specs: VerifierSpec[],
  opts: { stopOnRequiredFail?: boolean } = {},
): Promise<{ passed: boolean; results: VerifierResult[] }> {
  const stopOnRequiredFail = opts.stopOnRequiredFail ?? true;
  const results: VerifierResult[] = [];
  let passed = true;
  for (const spec of specs) {
    const fn = verifiers[spec.kind] ?? verifiers.custom!;
    const r = await fn(input, output, spec.config);
    results.push(r);
    if (!r.passed) {
      passed = false;
      if (spec.required && stopOnRequiredFail) break;
    }
  }
  return { passed, results };
}

export function registerVerifier(kind: string, fn: VerifierFn): void {
  verifiers[kind] = fn;
}

// Grader API used by EvalCase + replay runner. Same shape as verifiers but for one-shot pass/fail with expected.
export function gradeOutput(
  inputs: Record<string, unknown>,
  output: unknown,
  expected: string | Record<string, unknown>,
  grader: { kind: string; config: Record<string, unknown> },
): VerifierResult {
  const cfg = grader.config;
  switch (grader.kind) {
    case "exact": {
      const passed = JSON.stringify(output) === JSON.stringify(expected);
      return { kind: "exact", passed, detail: passed ? "ok" : "mismatch" };
    }
    case "regex": {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const pat = String(cfg.pattern ?? expected);
      const ok = new RegExp(pat, String(cfg.flags ?? "i")).test(text);
      return { kind: "regex", passed: ok, detail: `pattern=/${pat}/` };
    }
    case "schema": {
      const required = Array.isArray(cfg.required) ? (cfg.required as string[]) : Object.keys(expected as object);
      if (typeof output !== "object" || output === null)
        return { kind: "schema", passed: false, detail: "output not object" };
      const missing = required.filter((k) => !(k in (output as Record<string, unknown>)));
      return { kind: "schema", passed: missing.length === 0, detail: missing.length === 0 ? "ok" : `missing:${missing.join(",")}` };
    }
    case "exec": {
      const name = String(cfg.predicate ?? "");
      const fn = execPredicates[name];
      if (!fn) return { kind: "exec", passed: false, detail: `unknown predicate: ${name}` };
      const r = fn(inputs, output, cfg);
      return { kind: "exec", passed: r.passed, detail: r.detail ?? "" };
    }
    case "llm_judge":
    default: {
      const must = Array.isArray(cfg.must_include) ? (cfg.must_include as string[]) : [];
      const banned = Array.isArray(cfg.must_not_include) ? (cfg.must_not_include as string[]) : [];
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const missMust = must.filter((s) => !text.toLowerCase().includes(s.toLowerCase()));
      const hitBan = banned.filter((s) => text.toLowerCase().includes(s.toLowerCase()));
      const passed = missMust.length === 0 && hitBan.length === 0;
      return { kind: "llm_judge", passed, detail: passed ? "ok" : `missing=[${missMust.join(",")}] banned=[${hitBan.join(",")}]` };
    }
  }
}
