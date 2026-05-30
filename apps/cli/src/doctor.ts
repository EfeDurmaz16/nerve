import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheckInput {
  cwd?: string;
  env?: Record<string, string | undefined>;
  portInUse?: boolean;
}

export interface DoctorReport {
  status: DoctorStatus;
  cwd: string;
  git: {
    isRepo: boolean;
    hasRemote: boolean;
    currentCommit?: string;
  };
  security: {
    envIgnored: boolean;
    envExampleExists: boolean;
  };
  providers: {
    selectedProvider?: string;
    groqConfigured: boolean;
    openaiConfigured: boolean;
    ollamaBaseUrl?: string;
  };
  proof: {
    exists: boolean;
    readyForLocalDemo: boolean;
    estimatedReplayCostReductionPct?: number;
    groqLiveMeasured?: boolean;
  };
  server: {
    port: number;
    portInUse: boolean;
  };
  recommendations: string[];
}

export function runDoctorCheck(input: DoctorCheckInput = {}): DoctorReport {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const gitConfig = readIfExists(resolve(cwd, ".git/config"));
  const gitHead = readIfExists(resolve(cwd, ".git/HEAD"));
  const gitHeadRef = gitHead?.startsWith("ref: ") ? gitHead.slice(5).trim() : undefined;
  const currentCommit = gitHeadRef ? readIfExists(resolve(cwd, ".git", gitHeadRef))?.trim() : gitHead?.trim();
  const gitignore = readIfExists(resolve(cwd, ".gitignore")) ?? "";
  const proof = readProof(resolve(cwd, "docs/experiments/tokenops-product-readiness-report.json"));
  const port = Number(env.TOKENOPS_PORT ?? env.NERVE_PORT ?? 8787);
  const recommendations: string[] = [];

  const isRepo = existsSync(resolve(cwd, ".git"));
  const hasRemote = /\[remote\s+"[^"]+"\]/.test(gitConfig ?? "");
  const envIgnored = gitignore.split(/\r?\n/).map((line) => line.trim()).includes(".env");
  const envExampleExists = existsSync(resolve(cwd, ".env.example"));
  const readyForLocalDemo = proof?.summary?.readyForLocalDemo === true;

  if (!isRepo) recommendations.push("Initialize git before pushing: git init -b main.");
  if (isRepo && !hasRemote) recommendations.push("Add a git remote before push: git remote add origin <repo-url>.");
  if (!envIgnored) recommendations.push("Add .env to .gitignore before committing provider keys.");
  if (!envExampleExists) recommendations.push("Add .env.example with safe configuration placeholders.");
  if (!proof) recommendations.push("Run tokenops proof to generate a current product-readiness report.");
  if (proof && !readyForLocalDemo) recommendations.push("Investigate failing readiness gates in docs/experiments/tokenops-product-readiness-report.json.");
  if (input.portInUse) recommendations.push(`Port ${port} is already in use; stop the existing server or set TOKENOPS_PORT.`);

  const fail = !envIgnored;
  const warn = recommendations.length > 0 || !readyForLocalDemo;
  return {
    status: fail ? "fail" : warn ? "warn" : "pass",
    cwd,
    git: {
      isRepo,
      hasRemote,
      currentCommit: currentCommit || undefined,
    },
    security: {
      envIgnored,
      envExampleExists,
    },
    providers: {
      selectedProvider: env.TOKENOPS_PROVIDER,
      groqConfigured: Boolean(env.GROQ_API_KEY),
      openaiConfigured: Boolean(env.OPENAI_API_KEY),
      ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    },
    proof: {
      exists: Boolean(proof),
      readyForLocalDemo,
      estimatedReplayCostReductionPct: proof?.summary?.estimatedReplayCostReductionPct,
      groqLiveMeasured: proof?.summary?.groqLiveMeasured,
    },
    server: {
      port,
      portInUse: Boolean(input.portInUse),
    },
    recommendations,
  };
}

function readProof(path: string): { summary?: { readyForLocalDemo?: boolean; estimatedReplayCostReductionPct?: number; groqLiveMeasured?: boolean } } | undefined {
  const raw = readIfExists(path);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as { summary?: { readyForLocalDemo?: boolean; estimatedReplayCostReductionPct?: number; groqLiveMeasured?: boolean } };
  } catch {
    return undefined;
  }
}

function readIfExists(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}
