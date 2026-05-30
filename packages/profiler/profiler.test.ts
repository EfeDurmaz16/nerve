import { describe, expect, it } from "vitest";
import { normalizeChatCompletionRequest } from "@tokenops/core";
import { classifyCacheability, classifyWorkload } from "./src/index.js";

describe("TokenOps profiler", () => {
  it("marks docs qa as safe semantic workload", () => {
    const req = normalizeChatCompletionRequest({ model: "gpt-5.5", messages: [{ role: "user", content: "What does the documentation say about quickstart?" }] });
    expect(classifyWorkload(req).workloadType).toBe("docs_qa");
    expect(classifyCacheability(req)).toBe("semantic_safe");
  });

  it("blocks semantic caching for payment secrets", () => {
    const req = normalizeChatCompletionRequest({ model: "gpt-5.5", messages: [{ role: "user", content: "Use this secret token to wire a payment" }] });
    expect(classifyWorkload(req).riskLevel).toBe("high");
    expect(classifyCacheability(req)).toBe("never_cache");
  });
});
