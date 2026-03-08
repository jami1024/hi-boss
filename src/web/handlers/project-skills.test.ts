import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createProjectSkillHandlers } from "./project-skills.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-project-skill-test-"));
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
  rpcHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>
): DaemonContext {
  return {
    db,
    router: {} as DaemonContext["router"],
    executor: {} as DaemonContext["executor"],
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
    rpcHandlers,
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
  skillName?: string;
  body?: unknown;
}): RouteContext {
  return {
    req: {} as RouteContext["req"],
    res: params.res,
    params: params.skillName
      ? { id: params.id, skillName: params.skillName }
      : { id: params.id },
    query: {},
    body: params.body,
    token: params.token,
  };
}

test("project skill handlers forward add/list payloads to RPC", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: tempDir });
    db.upsertProject({ id: "repo.a", name: "repo-a", root: tempDir, speakerAgent: "nex" });

    let addCaptured: Record<string, unknown> | undefined;
    let listCaptured: Record<string, unknown> | undefined;
    const handlers = createProjectSkillHandlers(
      buildDaemonContext(db, {
        "skill.remote.add": async (params) => {
          addCaptured = params;
          return { targetType: "project", targetId: "repo.a", skill: { skillName: "code-review" } };
        },
        "skill.remote.list": async (params) => {
          listCaptured = params;
          return { targetType: "project", targetId: "repo.a", skills: [] };
        },
      })
    );

    const addMock = createMockResponse();
    await handlers.addRemoteSkill(
      createRouteContext({
        token: "boss-token",
        res: addMock.res,
        id: "repo.a",
        body: {
          skillName: "code-review",
          sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
          ref: "main",
        },
      })
    );
    assert.equal(addMock.getStatus(), 201);
    assert.deepEqual(addCaptured, {
      token: "boss-token",
      projectId: "repo.a",
      skillName: "code-review",
      sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
      ref: "main",
    });

    const listMock = createMockResponse();
    await handlers.listRemoteSkills(
      createRouteContext({ token: "boss-token", res: listMock.res, id: "repo.a" })
    );
    assert.equal(listMock.getStatus(), 200);
    assert.deepEqual(listCaptured, { token: "boss-token", projectId: "repo.a" });
  });
});

test("project skill handlers map RPC invalid params to HTTP 400", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: tempDir });
    db.upsertProject({ id: "repo.a", name: "repo-a", root: tempDir, speakerAgent: "nex" });

    const handlers = createProjectSkillHandlers(
      buildDaemonContext(db, {
        "skill.remote.update": async () => {
          throw Object.assign(new Error("Invalid source URL"), {
            code: -32602,
            data: {
              errorCode: "invalid-source-url",
              hint: "Use a github.com https URL",
            },
          });
        },
      })
    );

    const mock = createMockResponse();
    await handlers.updateRemoteSkill(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: "repo.a",
        skillName: "code-review",
        body: { sourceUrl: "http://insecure.example" },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Invalid source URL",
      errorCode: "invalid-source-url",
      hint: "Use a github.com https URL",
    });
  });
});
