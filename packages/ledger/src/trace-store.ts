import type { RequestTrace } from "@tokenops/core";

export class TraceStore {
  private readonly traces = new Map<string, RequestTrace>();

  insert(trace: RequestTrace): void {
    this.traces.set(trace.id, redactTrace(trace));
  }

  get(id: string): RequestTrace | null {
    return this.traces.get(id) ?? null;
  }

  list(limit = 100): RequestTrace[] {
    return [...this.traces.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }

  clear(): void {
    this.traces.clear();
  }
}

export function redactTrace(trace: RequestTrace): RequestTrace {
  return JSON.parse(JSON.stringify(trace, (key, value) => {
    if (isSensitiveKey(key) && typeof value === "string") return "[REDACTED]";
    if (typeof value !== "string") return value;
    return value
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]")
      .replace(/gsk_[A-Za-z0-9_\-]+/g, "gsk_[REDACTED]")
      .replace(/sk-[A-Za-z0-9_\-]+/g, "sk-[REDACTED]");
  })) as RequestTrace;
}

function isSensitiveKey(key: string): boolean {
  return /^(authorization|cookie|set-cookie|api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token)$/i.test(key);
}
