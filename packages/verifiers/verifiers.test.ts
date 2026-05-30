import { describe, it, expect } from "vitest";
import { runVerifiers, gradeOutput } from "@nerve/verifiers";

describe("runVerifiers", () => {
  it("passes schema check when all required fields present", async () => {
    const r = await runVerifiers({}, { name: "x", age: 1 }, [
      { kind: "schema", config: { required: ["name", "age"] }, required: true },
    ]);
    expect(r.passed).toBe(true);
  });

  it("fails schema check on missing field", async () => {
    const r = await runVerifiers({}, { name: "x" }, [
      { kind: "schema", config: { required: ["name", "age"] }, required: true },
    ]);
    expect(r.passed).toBe(false);
    expect(r.results[0]!.detail).toContain("missing");
  });

  it("runs exec predicate when registered", async () => {
    const r = await runVerifiers({}, "SELECT a FROM b JOIN c ON b.id = c.b_id", [
      {
        kind: "exec",
        config: { predicate: "sql_must_contain", tokens: ["join", "on"] },
        required: true,
      },
    ]);
    expect(r.passed).toBe(true);
  });
});

describe("gradeOutput", () => {
  it("exact-matches identical JSON", () => {
    const r = gradeOutput({}, { a: 1 }, { a: 1 }, { kind: "exact", config: {} });
    expect(r.passed).toBe(true);
  });

  it("llm_judge passes when no banned tokens present", () => {
    const r = gradeOutput(
      {},
      "SELECT name FROM users",
      "anything",
      { kind: "llm_judge", config: { must_not_include: ["error"], must_include: [] } },
    );
    expect(r.passed).toBe(true);
  });
});
