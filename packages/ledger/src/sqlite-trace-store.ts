import type { DB } from "@nerve/store";
import { getTokenOpsTrace, insertTokenOpsTrace, listTokenOpsTraces } from "@nerve/store";
import type { RequestTrace } from "@tokenops/core";
import { redactTrace } from "./trace-store.js";

export class SqliteTraceStore {
  constructor(private readonly db: DB) {}

  insert(trace: RequestTrace): void {
    insertTokenOpsTrace(this.db, redactTrace(trace));
  }

  get(id: string): RequestTrace | null {
    return getTokenOpsTrace(this.db, id);
  }

  list(limit = 100): RequestTrace[] {
    return listTokenOpsTraces(this.db, { limit });
  }

  clear(): void {
    this.db.prepare("DELETE FROM tokenops_request_traces").run();
  }
}
