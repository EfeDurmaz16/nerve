import { createHash } from "node:crypto";

export class HashedEmbeddingIndex {
  constructor(readonly dimensions = 256) {
    if (dimensions <= 0) throw new Error("dimensions must be positive");
  }

  embed(text: string): number[] {
    const vector = Array.from({ length: this.dimensions }, () => 0);
    for (const token of tokens(text)) {
      const index = hashToInt(token) % this.dimensions;
      vector[index] = (vector[index] ?? 0) + 1;
    }
    return normalize(vector);
  }

  similarity(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
    return Math.round(dot * 10_000) / 10_000;
  }
}

function tokens(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2);
  return raw.flatMap((token) => [stem(token), ...charTrigrams(stem(token))]);
}

function stem(token: string): string {
  return token
    .replace(/documentation/g, "docs")
    .replace(/installing|installed|install/g, "install")
    .replace(/setting/g, "setup")
    .replace(/quickstarts/g, "quickstart")
    .replace(/caches/g, "cache");
}

function charTrigrams(token: string): string[] {
  if (token.length <= 3) return [token];
  const out: string[] = [];
  for (let i = 0; i <= token.length - 3; i++) out.push(token.slice(i, i + 3));
  return out;
}

function hashToInt(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}
