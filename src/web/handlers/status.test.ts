import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createStatusHandlers } from "./status.js";

function withTempDb(run: (db: HiBossDatabase) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-status-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildDaemonContext(db: HiBossDatabase, busyNames: string[] = []): DaemonContext {
  return {
    db,
    router: {
      routeEnvelope: async (input) => db.createEnvelope(input),
    } as DaemonContext["router"],
    executor: {
      isAgentBusy: (name: string) => busyNames.includes(name),
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

function createRouteContext(token: string, res: RouteContext["res"]): RouteContext {
  return {
    req: {} as RouteContext["req"],
    res,
    params: {},
    query: {},
    body: undefined,
    token,
  };
}

test("getStatus includes current run session target and project id", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.setConfig("boss_name", "boss");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });

    const envelope = db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "run" },
      metadata: { projectId: "repo.a" },
    });
    db.createAgentRun("nex", [envelope.id]);

    const handlers = createStatusHandlers(buildDaemonContext(db, ["nex"]));
    const mock = createMockResponse();

    await handlers.getStatus(createRouteContext("boss-token", mock.res));

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as {
      agents: Array<{
        name: string;
        currentRun?: {
          sessionTarget?: string;
          projectId?: string;
        };
      }>;
    };
    const nex = body.agents.find((agent) => agent.name === "nex");
    assert.equal(nex?.currentRun?.sessionTarget, "nex:repo.a");
    assert.equal(nex?.currentRun?.projectId, "repo.a");
  });
});
