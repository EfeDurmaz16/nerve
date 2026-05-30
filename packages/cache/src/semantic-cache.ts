import { messageToText, type ModelResponse, type NormalizedRequest } from "@tokenops/core";
import { classifyCacheability } from "@tokenops/profiler";
import { HashedEmbeddingIndex } from "./hashed-embedding.js";

interface SemanticEntry {
  text: string;
  response: ModelResponse;
}

export class SemanticCache {
  private readonly entries: SemanticEntry[] = [];
  private readonly embeddings = new HashedEmbeddingIndex();
  private rejectedPoisonedEntries = 0;
  constructor(private readonly threshold = 0.72) {}

  get(request: NormalizedRequest): ModelResponse | null {
    if (classifyCacheability(request) !== "semantic_safe") return null;
    const text = request.messages.map(messageToText).join(" ");
    let best: { score: number; entry: SemanticEntry } | null = null;
    for (const entry of this.entries) {
      const score = semanticSimilarity(text, entry.text, this.embeddings);
      if (!best || score > best.score) best = { score, entry };
    }
    return best && best.score >= this.threshold ? best.entry.response : null;
  }

  set(request: NormalizedRequest, response: ModelResponse): void {
    if (classifyCacheability(request) !== "semantic_safe") return;
    if (isPoisonedSemanticResponse(response)) {
      this.rejectedPoisonedEntries += 1;
      return;
    }
    this.entries.push({ text: request.messages.map(messageToText).join(" "), response });
  }

  stats() {
    return { entries: this.entries.length, threshold: this.threshold, rejectedPoisonedEntries: this.rejectedPoisonedEntries };
  }
}

export function isPoisonedSemanticResponse(response: ModelResponse): boolean {
  const text = response.content.toLowerCase();
  return /ignore (all )?(previous|prior|above) instructions/.test(text) ||
    /reveal (the )?(system prompt|developer message|secrets?|api keys?|private keys?)/.test(text) ||
    /exfiltrat(e|ion)|jailbreak|prompt injection/.test(text) ||
    /BEGIN_SYSTEM_PROMPT|BEGIN DEVELOPER MESSAGE/i.test(response.content);
}

export function lexicalSimilarity(a: string, b: string): number {
  const aw = words(a);
  const bw = words(b);
  if (aw.size === 0 || bw.size === 0) return 0;
  const intersection = [...aw].filter((w) => bw.has(w)).length;
  const union = new Set([...aw, ...bw]).size;
  return intersection / union;
}

export function semanticSimilarity(a: string, b: string, embeddings = new HashedEmbeddingIndex()): number {
  return Math.max(lexicalSimilarity(a, b), embeddings.similarity(embeddings.embed(a), embeddings.embed(b)));
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
