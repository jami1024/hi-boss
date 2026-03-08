import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createAgentHandlers } from "./agents.js";

function withTempDb(run: (db: HiBossDatabase) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-agent-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildDaemonContext(
  db: HiBossDatabase,
  rpcAgentRefresh: (params: Record<string, unknown>) => Promise<unknown>,
  busyNames: string[] = [],
  extraRpcHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {}
): DaemonContext {
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
      const agent = db.findAgentByToken(token);
      if (!agent) {
        throw Object.assign(new Error("Access denied"), { code: -32001 });
      }
      return {
        kind: "agent",
        level: agent.permissionLevel ?? "standard",
        agent,
      };
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
    rpcHandlers: {
      "agent.refresh": rpcAgentRefresh,
      ...extraRpcHandlers,
    },
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
  name: string;
  body?: unknown;
}): RouteContext {
  return {
    req: {} as RouteContext["req"],
    res: params.res,
    params: { name: params.name },
    query: {},
    body: params.body,
    token: params.token,
  };
}

test("refreshAgent forwards optional projectId to RPC", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");

    let captured: Record<string, unknown> | undefined;
    const handlers = createAgentHandlers(
      buildDaemonContext(db, async (params) => {
        captured = params;
        return { success: true, agentName: "nex" };
      })
    );

    const mock = createMockResponse();
    await handlers.refreshAgent(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        name: "nex",
        body: { projectId: "repo.a" },
      })
    );

    assert.equal(mock.getStatus(), 200);
    assert.deepEqual(captured, {
      token: "boss-token",
      agentName: "nex",
      projectId: "repo.a",
    });
  });
});

test("refreshAgent maps invalid params from RPC to HTTP 400", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");

    const handlers = createAgentHandlers(
      buildDaemonContext(db, async () => {
        throw Object.assign(new Error("Invalid project-id"), { code: -32602 });
      })
    );

    const mock = createMockResponse();
    await handlers.refreshAgent(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        name: "nex",
        body: { projectId: "BAD" },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), { error: "Invalid project-id" });
  });
});

test("getAgentStatus includes current session target and project id for project-scoped run", async () => {
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

    const handlers = createAgentHandlers(
      buildDaemonContext(db, async () => ({ success: true, agentName: "nex" }), ["nex"])
    );

    const mock = createMockResponse();
    await handlers.getAgentStatus(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        name: "nex",
      })
    );

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as {
      status: {
        currentRun: {
          sessionTarget?: string;
          projectId?: string;
        } | null;
      };
    };
    assert.equal(body.status.currentRun?.sessionTarget, "nex:repo.a");
    assert.equal(body.status.currentRun?.projectId, "repo.a");
  });
});

test("listRemoteSkills forwards agent target to RPC", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");

    let captured: Record<string, unknown> | undefined;
    const handlers = createAgentHandlers(
      buildDaemonContext(
        db,
        async () => ({ success: true, agentName: "nex" }),
        [],
        {
          "skill.remote.list": async (params) => {
            captured = params;
            return { targetType: "agent", targetId: "nex", skills: [] };
          },
        }
      )
    );

    const mock = createMockResponse();
    await handlers.listRemoteSkills(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        name: "nex",
      })
    );

    assert.equal(mock.getStatus(), 200);
    assert.deepEqual(captured, { token: "boss-token", agentName: "nex" });
  });
});

test("addRemoteSkill forwards payload to RPC", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");

    let captured: Record<string, unknown> | undefined;
    const handlers = createAgentHandlers(
      buildDaemonContext(
        db,
        async () => ({ success: true, agentName: "nex" }),
        [],
        {
          "skill.remote.add": async (params) => {
            captured = params;
            return {
              targetType: "agent",
              targetId: "nex",
              skill: { skillName: "code-review" },
            };
          },
        }
      )
    );

    const mock = createMockResponse();
    await handlers.addRemoteSkill(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        name: "nex",
        body: {
          skillName: "code-review",
          sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
          ref: "main",
        },
      })
    );

    assert.equal(mock.getStatus(), 201);
    assert.deepEqual(captured, {
      token: "boss-token",
      agentName: "nex",
      skillName: "code-review",
      sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
      ref: "main",
    });
  });
});

test("addRemoteSkill includes errorCode and hint from RPC errors", async () => {
  await withTempDb(async (db) => {
    db.setBossToken("boss-token");

    const handlers = createAgentHandlers(
      buildDaemonContext(
        db,
        async () => ({ success: true, agentName: "nex" }),
        [],
        {
          "skill.remote.add": async () => {
            throw Object.assign(new Error("Remote skill source must use https://"), {
              code: -32602,
              data: {
                errorCode: "insecure-source-url",
                hint: "Use HTTPS sources only.",
              },
            });
          },
        }
      )
    );

    const mock = createMockResponse();
    await handlers.addRemoteSkill(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        name: "nex",
        body: {
          skillName: "code-review",
          sourceUrl: "http://example.com/skill",
        },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Remote skill source must use https://",
      errorCode: "insecure-source-url",
      hint: "Use HTTPS sources only.",
    });
  });
});
