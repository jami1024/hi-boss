import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createProjectMemoryHandlers } from "./project-memory.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-project-memory-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildDaemonContext(
  db: HiBossDatabase,
  refreshCalls: Array<{ agentName: string; reason: string; scope: string; projectId?: string }>
): DaemonContext {
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
      dataDir: os.tmpdir(),
      daemonDir: os.tmpdir(),
    },
    running: true,
    startTimeMs: Date.now(),
    resolvePrincipal: (token: string): Principal => {
      if (db.verifyBossToken(token)) {
        return { kind: "boss", level: "boss" };
      }
      throw Object.assign(new Error("Access denied"), { code: -32001 });
    },
    assertOperationAllowed: () => undefined,
    getPermissionPolicy: () => ({
      version: 1,
      defaultLevel: "restricted",
      levelWeights: { restricted: 0, standard: 1, privileged: 2, boss: 3 },
      operations: {},
      inheritance: {},
    }),
    createAdapterForBinding: async () => null,
    removeAdapter: async () => undefined,
    registerAgentHandler: () => undefined,
    rpcHandlers: {},
  };
}

function createMockResponse(): {
  res: RouteContext["res"];
  getStatus: () => number;
  getBody: () => unknown;
} {
  let status = 0;
  let payload = "";
  const res = {
    writeHead: (code: number) => {
      status = code;
      return res;
    },
    end: (body?: string | Buffer) => {
      payload = typeof body === "string" ? body : body ? body.toString("utf-8") : "";
      return res;
    },
  } as unknown as RouteContext["res"];

  return {
    res,
    getStatus: () => status,
    getBody: () => (payload ? JSON.parse(payload) : undefined),
  };
}

function createRouteContext(params: {
  token: string;
  res: RouteContext["res"];
  id: string;
  entryName?: string;
  body?: unknown;
}): RouteContext {
  return {
    req: {} as RouteContext["req"],
    res: params.res,
    params: params.entryName ? { id: params.id, entryName: params.entryName } : { id: params.id },
    query: {},
    body: params.body,
    token: params.token,
  };
}

test("project memory handlers support upsert/list/get/delete with refresh summary", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: tempDir });
    db.registerAgent({ name: "kai", provider: "codex", role: "leader", workspace: tempDir });
    db.registerAgent({ name: "leo", provider: "codex", role: "leader", workspace: tempDir });
    db.upsertProject({ id: "repo.a", name: "repo-a", root: tempDir, speakerAgent: "nex" });
    db.upsertProjectLeader({ projectId: "repo.a", agentName: "kai", active: true });
    db.upsertProjectLeader({ projectId: "repo.a", agentName: "leo", active: true });

    const refreshCalls: Array<{ agentName: string; reason: string; scope: string; projectId?: string }> = [];
    const handlers = createProjectMemoryHandlers(buildDaemonContext(db, refreshCalls));

    const upsertMock = createMockResponse();
    await handlers.upsertMemoryEntry(
      createRouteContext({
        token: "boss-token",
        res: upsertMock.res,
        id: "repo.a",
        entryName: "notes.md",
        body: { content: "first memory line" },
      })
    );
    assert.equal(upsertMock.getStatus(), 200);
    const upsertBody = upsertMock.getBody() as {
      entry: { name: string; content: string };
      refresh: { count: number };
    };
    assert.equal(upsertBody.entry.name, "notes.md");
    assert.equal(upsertBody.entry.content, "first memory line");
    assert.equal(upsertBody.refresh.count, 3);

    const listMock = createMockResponse();
    await handlers.listMemory(
      createRouteContext({
        token: "boss-token",
        res: listMock.res,
        id: "repo.a",
      })
    );
    assert.equal(listMock.getStatus(), 200);
    const listBody = listMock.getBody() as { entries: Array<{ name: string }> };
    assert.deepEqual(listBody.entries.map((entry) => entry.name), ["notes.md"]);

    const getMock = createMockResponse();
    await handlers.getMemoryEntry(
      createRouteContext({
        token: "boss-token",
        res: getMock.res,
        id: "repo.a",
        entryName: "notes.md",
      })
    );
    assert.equal(getMock.getStatus(), 200);
    const getBody = getMock.getBody() as { entry: { content: string } };
    assert.equal(getBody.entry.content, "first memory line");

    const deleteMock = createMockResponse();
    await handlers.deleteMemoryEntry(
      createRouteContext({
        token: "boss-token",
        res: deleteMock.res,
        id: "repo.a",
        entryName: "notes.md",
      })
    );
    assert.equal(deleteMock.getStatus(), 200);
    const deleteBody = deleteMock.getBody() as { success: boolean; refresh: { count: number } };
    assert.equal(deleteBody.success, true);
    assert.equal(deleteBody.refresh.count, 3);

    assert.deepEqual(
      refreshCalls.map((item) => item.agentName).sort((a, b) => a.localeCompare(b)),
      ["kai", "kai", "leo", "leo", "nex", "nex"]
    );
  });
});

test("project memory handlers reject invalid entry names", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: tempDir });
    db.upsertProject({ id: "repo.a", name: "repo-a", root: tempDir, speakerAgent: "nex" });

    const refreshCalls: Array<{ agentName: string; reason: string; scope: string; projectId?: string }> = [];
    const handlers = createProjectMemoryHandlers(buildDaemonContext(db, refreshCalls));
    const mock = createMockResponse();

    await handlers.upsertMemoryEntry(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: "repo.a",
        entryName: "../escape.md",
        body: { content: "x" },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), { error: "Project ID and valid entry name required" });
    assert.equal(refreshCalls.length, 0);
  });
});
