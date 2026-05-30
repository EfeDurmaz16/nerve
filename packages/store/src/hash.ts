import { createHash } from "node:crypto";

export const sha256 = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

export const hashJson = (value: unknown): string => sha256(canonicalize(value));

// Stable canonical JSON (sorted keys) so equal objects produce equal hashes.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as object).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}
