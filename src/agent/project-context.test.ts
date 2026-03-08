import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Envelope } from "../envelope/types.js";
import { HiBossDatabase } from "../daemon/db/database.js";
import { resolveAgentRunProjectScope } from "./project-context.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-project-context-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  try {
    run(db, tempDir);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function createEnvelope(params: { id: string; projectId?: string }): Envelope {
  return {
    id: params.id,
    from: "channel:web:boss",
    to: "agent:nex",
    fromBoss: true,
    content: { text: "hello" },
    status: "pending",
    createdAt: Date.now(),
    metadata: params.projectId ? { projectId: params.projectId } : {},
  };
}

test("resolveAgentRunProjectScope falls back to agent session when projectId is absent", () => {
  withTempDb((db) => {
    const scope = resolveAgentRunProjectScope({
      db,
      agentName: "nex",
      envelopes: [createEnvelope({ id: "env-no-project" })],
    });

    assert.equal(scope.sessionKey, "nex");
    assert.equal(scope.isProjectScoped, false);
    assert.equal(scope.projectId, undefined);
    assert.equal(scope.workspaceOverride, undefined);
    assert.equal(scope.additionalContext, undefined);
  });
});

test("resolveAgentRunProjectScope returns project session key and prompt context", () => {
  withTempDb((db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-a");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "HIBOSS.md"), "Use pnpm and keep commits atomic.\n", "utf-8");
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ scripts: { build: "tsc -b", test: "node --test" } }),
      "utf-8"
    );
    fs.mkdirSync(path.join(projectRoot, ".hiboss", "skills", "code-review"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".hiboss", "skills", "code-review", "SKILL.md"),
      "# code-review\nReview changes and identify risks.",
      "utf-8"
    );
    fs.mkdirSync(path.join(projectRoot, ".hiboss", "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".hiboss", "memory", "context.md"),
      "Important previous decisions and constraints.",
      "utf-8"
    );

    db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: projectRoot });
    db.registerAgent({ name: "kai", provider: "codex", role: "leader", workspace: "/tmp/other-a" });
    db.registerAgent({ name: "leo", provider: "codex", role: "leader", workspace: "/tmp/other-b" });
    db.upsertProject({ id: "prj-a", name: "repo-a", root: projectRoot, speakerAgent: "nex" });
    db.upsertProjectLeader({ projectId: "prj-a", agentName: "kai", capabilities: ["implementation"], active: true });
    db.upsertProjectLeader({ projectId: "prj-a", agentName: "leo", capabilities: ["review"], active: true });

    const scope = resolveAgentRunProjectScope({
      db,
      agentName: "nex",
      envelopes: [createEnvelope({ id: "env-project", projectId: "prj-a" })],
    });

    assert.equal(scope.sessionKey, "nex:prj-a");
    assert.equal(scope.isProjectScoped, true);
    assert.equal(scope.projectId, "prj-a");
    assert.equal(scope.workspaceOverride, projectRoot);
    assert.ok(scope.additionalContext?.includes("## project-context"));
    assert.ok(scope.additionalContext?.includes("project-id: prj-a"));
    assert.ok(scope.additionalContext?.includes("project-root: "));
    assert.ok(scope.additionalContext?.includes("workspace-restriction: operate only inside project-root"));
    assert.ok(scope.additionalContext?.includes("## project-instructions (HIBOSS.md)"));
    assert.ok(scope.additionalContext?.includes("Use pnpm and keep commits atomic."));
    assert.ok(scope.additionalContext?.includes("## project-skills (package.json scripts)"));
    assert.ok(scope.additionalContext?.includes("- build: tsc -b"));
    assert.ok(scope.additionalContext?.includes("- test: node --test"));
    assert.ok(scope.additionalContext?.includes("## project-skills (local SKILL.md)"));
    assert.ok(scope.additionalContext?.includes("- code-review: Review changes and identify risks."));
    assert.ok(scope.additionalContext?.includes("## project-memory-snapshot (.hiboss/memory)"));
    assert.ok(scope.additionalContext?.includes("- context.md: Important previous decisions and constraints."));
    assert.ok(scope.additionalContext?.includes("allowed-leaders:"));
    assert.ok(scope.additionalContext?.includes("kai"));
    assert.ok(scope.additionalContext?.includes("leo"));
  });
});

test("resolveAgentRunProjectScope rejects mixed project IDs in one run", () => {
  withTempDb((db) => {
    assert.throws(
      () =>
        resolveAgentRunProjectScope({
          db,
          agentName: "nex",
          envelopes: [
            createEnvelope({ id: "env-a", projectId: "prj-a" }),
            createEnvelope({ id: "env-b", projectId: "prj-b" }),
          ],
        }),
      /Conflicting project context in a single agent run/
    );
  });
});

test("resolveAgentRunProjectScope rejects unknown projectId", () => {
  withTempDb((db) => {
    assert.throws(
      () =>
        resolveAgentRunProjectScope({
          db,
          agentName: "nex",
          envelopes: [createEnvelope({ id: "env-missing", projectId: "prj-missing" })],
        }),
      /Project 'prj-missing' not found/
    );
  });
});
