import { hashJson, type NormalizedRequest } from "@tokenops/core";

export function contextBlockFingerprints(request: NormalizedRequest): Record<string, string> {
  const system = request.messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => m.content);
  return {
    systemPromptHash: hashJson(system),
    toolSchemaHash: hashJson(request.tools),
    metadataContextHash: hashJson(request.metadata.context ?? null),
  };
}
