import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import { buildAgentWsStatus } from "./chat.js";

function withTempDb(run: (db: HiBossDatabase) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-ws-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildDaemonContext(db: HiBossDatabase, busyAgents: string[] = []): DaemonContext {
  return {
    db,
    router: {
      routeEnvelope: async (input) => db.createEnvelope(input),
    } as DaemonContext["router"],
    executor: {
      isAgentBusy: (name: string) => busyAgents.includes(name),
    } as unknown as DaemonContext["executor"],
    scheduler: {
      onEnvelopeCreated: () => undefined,
    } as unknown as DaemonContext["scheduler"],
    cronScheduler: null,
    adapters: new Map(),
    config: {
      dataDir: os.tmpdir(),
      daemonDir: os.tmpdir(),
    },
    running: true,
    startTimeMs: Date.now(),
    resolvePrincipal: (_token: string): Principal => ({ kind: "boss", level: "boss" }),
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

test("buildAgentWsStatus returns null for missing agent", async () => {
  await withTempDb(async (db) => {
    const status = buildAgentWsStatus({
      daemon: buildDaemonContext(db),
      agentName: "missing",
    });
    assert.equal(status, null);
  });
});

test("buildAgentWsStatus includes session target and project id for project-scoped run", async () => {
  await withTempDb(async (db) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    const envelope = db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "run" },
      metadata: { projectId: "repo.a" },
    });
    db.createAgentRun("nex", [envelope.id]);

    const status = buildAgentWsStatus({
      daemon: buildDaemonContext(db, ["nex"]),
      agentName: "nex",
    });

    assert.equal(status?.agentState, "running");
    assert.equal(status?.currentRun?.sessionTarget, "nex:repo.a");
    assert.equal(status?.currentRun?.projectId, "repo.a");
  });
});
