import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createEnvelopeHandlers } from "./envelopes.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-envelope-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildDaemonContext(db: HiBossDatabase): DaemonContext {
  return {
    db,
    router: {
      routeEnvelope: async (input) => db.createEnvelope(input),
    } as DaemonContext["router"],
    executor: {
      isAgentBusy: () => false,
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

function createRouteContext(params: {
  token: string;
  res: RouteContext["res"];
  agentName: string;
  body?: unknown;
}): RouteContext {
  return {
    req: {} as RouteContext["req"],
    res: params.res,
    params: { agentName: params.agentName },
    query: {},
    body: params.body,
    token: params.token,
  };
}

test("sendMessage rejects leader direct chat", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "kai", provider: "codex", role: "leader" });
    const handlers = createEnvelopeHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.sendMessage(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        agentName: "kai",
        body: { text: "hello" },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Direct chat is only available for speaker agents",
    });
  });
});

test("sendMessage rejects speaker already bound to a project", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const speaker = db.registerAgent({ name: "nex", provider: "codex", role: "speaker" }).agent;
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: speaker.name,
    });

    const handlers = createEnvelopeHandlers(buildDaemonContext(db));
    const mock = createMockResponse();
    await handlers.sendMessage(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        agentName: "nex",
        body: { text: "hello" },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Speaker 'nex' is bound to project 'repo.a'. Use project chat instead.",
    });
  });
});

test("sendMessage allows unbound speaker direct chat", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "free", provider: "codex", role: "speaker" });
    const handlers = createEnvelopeHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.sendMessage(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        agentName: "free",
        body: { text: "hello" },
      })
    );

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as { id: string };
    const envelope = db.getEnvelopeById(body.id);
    assert.equal(envelope?.to, "agent:free");
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.source, "web");
  });
});

test("listMessages rejects leader direct chat route", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "kai", provider: "codex", role: "leader" });
    const handlers = createEnvelopeHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.listMessages(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        agentName: "kai",
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Direct chat is only available for speaker agents",
    });
  });
});
