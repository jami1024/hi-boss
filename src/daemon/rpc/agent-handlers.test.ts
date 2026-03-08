import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PERMISSION_POLICY } from "../../shared/permissions.js";
import { HiBossDatabase } from "../db/database.js";
import type { DaemonContext, Principal } from "./context.js";
import { createAgentHandlers } from "./agent-handlers.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-rpc-agent-test-"));
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
  refreshCalls: Array<{ agentName: string; reason: string; scope?: string; projectId?: string }>,
  busyNames: string[] = []
): DaemonContext {
  const resolvePrincipal = (token: string): Principal => {
    if (db.verifyBossToken(token)) {
      return { kind: "boss", level: "boss" };
    }
    throw Object.assign(new Error("Access denied"), { code: -32001 });
  };

  return {
    db,
    router: {} as DaemonContext["router"],
    executor: {
      isAgentBusy: (name: string) => busyNames.includes(name),
      requestSessionRefresh: (
        agentName: string,
        reason: string,
        scope?: "agent" | "auto-project" | "project",
        projectId?: string
      ) => {
        refreshCalls.push({ agentName, reason, scope, projectId });
      },
    } as unknown as DaemonContext["executor"],
    scheduler: {} as DaemonContext["scheduler"],
    cronScheduler: null,
    adapters: new Map(),
    config: {
      dataDir: os.tmpdir(),
      daemonDir: os.tmpdir(),
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

test("agent.refresh without projectId keeps auto-project scope", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    const refreshCalls: Array<{ agentName: string; reason: string; scope?: string; projectId?: string }> = [];
    const handlers = createAgentHandlers(buildBossContext(db, refreshCalls));

    const result = (await handlers["agent.refresh"]({
      token: "boss-token",
      agentName: "nex",
    })) as { success: boolean; agentName: string };

    assert.equal(result.success, true);
    assert.equal(result.agentName, "nex");
    assert.deepEqual(refreshCalls, [
      {
        agentName: "nex",
        reason: "rpc:agent.refresh",
        scope: "auto-project",
        projectId: undefined,
      },
    ]);
  });
});

test("agent.status includes current session target and project id for project-scoped run", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });

    const envelope = db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "run" },
      metadata: { projectId: "repo.a" },
    });
    db.createAgentRun("nex", [envelope.id]);

    const handlers = createAgentHandlers(buildBossContext(db, [], ["nex"]));
    const result = (await handlers["agent.status"]({
      token: "boss-token",
      agentName: "nex",
    })) as {
      status: {
        currentRun?: {
          sessionTarget?: string;
          projectId?: string;
        };
      };
    };

    assert.equal(result.status.currentRun?.sessionTarget, "nex:repo.a");
    assert.equal(result.status.currentRun?.projectId, "repo.a");
  });
});

test("agent.refresh with projectId targets explicit project session refresh", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
    });

    const refreshCalls: Array<{ agentName: string; reason: string; scope?: string; projectId?: string }> = [];
    const handlers = createAgentHandlers(buildBossContext(db, refreshCalls));

    const result = (await handlers["agent.refresh"]({
      token: "boss-token",
      agentName: "nex",
      projectId: " REPO.A ",
    })) as { success: boolean; agentName: string };

    assert.equal(result.success, true);
    assert.equal(result.agentName, "nex");
    assert.deepEqual(refreshCalls, [
      {
        agentName: "nex",
        reason: "rpc:agent.refresh",
        scope: "project",
        projectId: "repo.a",
      },
    ]);
  });
});

test("agent.refresh with malformed projectId is rejected", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    const handlers = createAgentHandlers(buildBossContext(db, []));

    await assert.rejects(
      async () => {
        await handlers["agent.refresh"]({
          token: "boss-token",
          agentName: "nex",
          projectId: "Bad Project",
        });
      },
      (err: unknown) => {
        const error = err as { code?: number; message?: string };
        assert.equal(error.code, -32602);
        assert.match(String(error.message), /Invalid project-id/);
        return true;
      }
    );
  });
});

test("agent.refresh with projectId rejects agent not bound to project", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "other", provider: "codex", role: "speaker" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "other",
    });

    const handlers = createAgentHandlers(buildBossContext(db, []));

    await assert.rejects(
      async () => {
        await handlers["agent.refresh"]({
          token: "boss-token",
          agentName: "nex",
          projectId: "repo.a",
        });
      },
      (err: unknown) => {
        const error = err as { code?: number; message?: string };
        assert.equal(error.code, -32602);
        assert.match(String(error.message), /is not bound to project/);
        return true;
      }
    );
  });
});
