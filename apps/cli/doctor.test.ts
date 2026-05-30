import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctorCheck } from "./src/doctor.js";

describe("tokenops doctor", () => {
  it("reports demo readiness, git hygiene, and provider configuration without exposing secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "tokenops-doctor-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "docs/experiments"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), ".env\nnode_modules\n");
    writeFileSync(join(root, ".env.example"), "TOKENOPS_PROVIDER=mock\n");
    writeFileSync(join(root, ".git/config"), "[remote \"origin\"]\n\turl = git@example.com:efe/tokenops.git\n");
    writeFileSync(join(root, "docs/experiments/tokenops-product-readiness-report.json"), JSON.stringify({
      summary: { readyForLocalDemo: true, estimatedReplayCostReductionPct: 95.5, groqLiveMeasured: true },
      passed: { replayShowsSavings: true },
      gaps: ["Distributed scheduler state is not implemented."],
    }));

    const report = runDoctorCheck({
      cwd: root,
      env: { GROQ_API_KEY: "gsk_real_secret_value", TOKENOPS_PROVIDER: "groq,mock" },
      portInUse: false,
    });

    expect(report.status).toBe("pass");
    expect(report.git.isRepo).toBe(true);
    expect(report.git.hasRemote).toBe(true);
    expect(report.security.envIgnored).toBe(true);
    expect(report.security.envExampleExists).toBe(true);
    expect(report.providers.groqConfigured).toBe(true);
    expect(JSON.stringify(report)).not.toContain("gsk_real_secret_value");
    expect(report.proof.readyForLocalDemo).toBe(true);
    expect(report.server.portInUse).toBe(false);
  });

  it("warns when no remote or proof report exists", () => {
    const root = mkdtempSync(join(tmpdir(), "tokenops-doctor-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), ".env\n");

    const report = runDoctorCheck({ cwd: root, env: {}, portInUse: false });

    expect(report.status).toBe("warn");
    expect(report.git.hasRemote).toBe(false);
    expect(report.proof.exists).toBe(false);
    expect(report.recommendations).toContain("Run tokenops proof to generate a current product-readiness report.");
    expect(report.recommendations).toContain("Add a git remote before push: git remote add origin <repo-url>.");
  });
});
