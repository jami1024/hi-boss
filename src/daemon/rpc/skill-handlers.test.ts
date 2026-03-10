import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getAgentDir } from "../../agent/home-setup.js";
import { DEFAULT_PERMISSION_POLICY } from "../../shared/permissions.js";
import { HiBossDatabase } from "../db/database.js";
import type { DaemonContext, Principal } from "./context.js";
import { createSkillHandlers } from "./skill-handlers.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-rpc-skill-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildBossContext(
  db: HiBossDatabase,
  tempDir: string,
  refreshCalls: Array<{ agentName: string; reason: string; scope: string; projectId?: string }> = []
): DaemonContext {
  const resolvePrincipal = (token: string): Principal => {
    if (!db.verifyBossToken(token)) {
      throw Object.assign(new Error("Access denied"), { code: -32001 });
    }
    return {
      kind: "boss",
      level: "boss",
    };
  };

  return {
    db,
    router: {} as DaemonContext["router"],
    executor: {
      requestSessionRefresh: (
        agentName: string,
        reason: string,
        scope: "agent" | "auto-project" | "project" = "agent",
        projectId?: string
      ) => {
        refreshCalls.push({
          agentName,
          reason,
          scope,
          ...(projectId ? { projectId } : {}),
        });
      },
    } as DaemonContext["executor"],
    scheduler: {} as DaemonContext["scheduler"],
    cronScheduler: null,
    adapters: new Map(),
    config: {
      dataDir: tempDir,
      daemonDir: tempDir,
    },
    running: true,
    startTimeMs: Date.now(),
    resolvePrincipal,
    assertOperationAllowed: () => undefined,
    getPermissionPolicy: () => DEFAULT_PERMISSION_POLICY,
    createAdapterForBinding: async () => null,
    removeAdapter: async () => undefined,
    registerAgentHandler: () => undefined,
    rpcHandlers: {},
  };
}

test("skill.remote.list returns stored remote metadata for agent target", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "leader", workspace: tempDir });

    const skillDir = path.join(getAgentDir("nex", tempDir), "skills", "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# code-review\n", "utf8");
    fs.writeFileSync(
      path.join(skillDir, ".source.json"),
      `${JSON.stringify(
        {
          skillName: "code-review",
          sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
          repositoryUrl: "https://github.com/acme/tooling.git",
          sourcePath: "skills/code-review",
          sourceRef: "main",
          commit: "abc123",
          checksum: "sha256",
          fileCount: 1,
          status: "valid",
          addedAt: "2026-03-08T00:00:00.000Z",
          lastUpdated: "2026-03-08T00:00:00.000Z",
          targetType: "agent",
          targetId: "nex",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const handlers = createSkillHandlers(buildBossContext(db, tempDir));
    const listRemote = handlers["skill.remote.list"];
    assert.ok(listRemote);
    const result = (await listRemote({
      token: "boss-token",
      agentName: "nex",
    })) as {
      targetType: string;
      targetId: string;
      skills: Array<{ skillName: string }>;
    };

    assert.equal(result.targetType, "agent");
    assert.equal(result.targetId, "nex");
    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0]?.skillName, "code-review");
  });
});

test("skill.remote.remove deletes remote skill folder", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "leader", workspace: tempDir });

    const refreshCalls: Array<{ agentName: string; reason: string; scope: string; projectId?: string }> = [];

    const skillDir = path.join(getAgentDir("nex", tempDir), "skills", "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# code-review\n", "utf8");
    fs.writeFileSync(
      path.join(skillDir, ".source.json"),
      `${JSON.stringify(
        {
          skillName: "code-review",
          sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
          repositoryUrl: "https://github.com/acme/tooling.git",
          sourcePath: "skills/code-review",
          sourceRef: "main",
          commit: "abc123",
          checksum: "sha256",
          fileCount: 1,
          status: "valid",
          addedAt: "2026-03-08T00:00:00.000Z",
          lastUpdated: "2026-03-08T00:00:00.000Z",
          targetType: "agent",
          targetId: "nex",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const handlers = createSkillHandlers(buildBossContext(db, tempDir, refreshCalls));
    const removeRemote = handlers["skill.remote.remove"];
    assert.ok(removeRemote);
    const result = (await removeRemote({
      token: "boss-token",
      agentName: "nex",
      skillName: "code-review",
    })) as { success: boolean; refresh: { count: number } };
    assert.equal(result.success, true);
    assert.equal(result.refresh.count, 1);
    assert.equal(fs.existsSync(skillDir), false);
    assert.deepEqual(refreshCalls, [
      {
        agentName: "nex",
        reason: "rpc:skill.remote.remove",
        scope: "agent",
      },
    ]);
  });
});

test("project-target remote skill removal refreshes project member sessions", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: tempDir });
    db.registerAgent({ name: "kai", provider: "codex", role: "leader", workspace: tempDir });
    db.registerAgent({ name: "leo", provider: "codex", role: "leader", workspace: tempDir });
    const projectRoot = path.join(tempDir, "repo-a");
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: projectRoot,
      speakerAgent: "nex",
    });
    db.upsertProjectLeader({ projectId: "repo.a", agentName: "kai", active: true });
    db.upsertProjectLeader({ projectId: "repo.a", agentName: "leo", active: true });

    const skillDir = path.join(projectRoot, ".hiboss", "skills", "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# code-review\n", "utf8");
    fs.writeFileSync(
      path.join(skillDir, ".source.json"),
      `${JSON.stringify(
        {
          skillName: "code-review",
          sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
          repositoryUrl: "https://github.com/acme/tooling.git",
          sourcePath: "skills/code-review",
          sourceRef: "main",
          commit: "abc123",
          checksum: "sha256",
          fileCount: 1,
          status: "valid",
          addedAt: "2026-03-08T00:00:00.000Z",
          lastUpdated: "2026-03-08T00:00:00.000Z",
          targetType: "project",
          targetId: "repo.a",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const refreshCalls: Array<{ agentName: string; reason: string; scope: string; projectId?: string }> = [];
    const handlers = createSkillHandlers(buildBossContext(db, tempDir, refreshCalls));
    const removeRemote = handlers["skill.remote.remove"];
    assert.ok(removeRemote);
    const result = (await removeRemote({
      token: "boss-token",
      projectId: "repo.a",
      skillName: "code-review",
    })) as { success: boolean; refresh: { count: number } };

    assert.equal(result.success, true);
    assert.equal(result.refresh.count, 3);
    assert.equal(fs.existsSync(skillDir), false);
    assert.deepEqual(
      refreshCalls.sort((a, b) => a.agentName.localeCompare(b.agentName)),
      [
        { agentName: "kai", reason: "rpc:skill.remote.remove", scope: "project", projectId: "repo.a" },
        { agentName: "leo", reason: "rpc:skill.remote.remove", scope: "project", projectId: "repo.a" },
        { agentName: "nex", reason: "rpc:skill.remote.remove", scope: "project", projectId: "repo.a" },
      ]
    );
  });
});

test("skill.remote.add returns structured error data for invalid source URL", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "leader", workspace: tempDir });

    const handlers = createSkillHandlers(buildBossContext(db, tempDir));
    const addRemote = handlers["skill.remote.add"];
    assert.ok(addRemote);

    await assert.rejects(
      () =>
        addRemote({
          token: "boss-token",
          agentName: "nex",
          skillName: "code-review",
          sourceUrl: "http://example.com/skill",
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const rpcCode = (err as Error & { code?: number }).code;
        const data = (err as Error & { data?: unknown }).data;
        const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
        return (
          rpcCode === -32602 &&
          payload.errorCode === "insecure-source-url" &&
          typeof payload.hint === "string"
        );
      }
    );
  });
});
