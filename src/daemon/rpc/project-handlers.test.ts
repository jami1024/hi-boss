import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PERMISSION_POLICY } from "../../shared/permissions.js";
import { HiBossDatabase } from "../db/database.js";
import { createProjectHandlers } from "./project-handlers.js";
import type { DaemonContext, Principal } from "./context.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-rpc-project-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildAgentContext(db: HiBossDatabase, tempDir: string, busyNames: string[] = []): DaemonContext {
  const resolvePrincipal = (token: string): Principal => {
    const agent = db.findAgentByToken(token);
    if (!agent) {
      throw Object.assign(new Error("Access denied"), { code: -32001 });
    }
    return {
      kind: "agent",
      level: agent.permissionLevel ?? "standard",
      agent,
    };
  };

  return {
    db,
    router: {} as DaemonContext["router"],
    executor: {
      isAgentBusy: (name: string) => busyNames.includes(name),
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

test("project.list and project.get return persisted project views", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: path.join(tempDir, "repo-a"),
    });
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: path.join(tempDir, "repo-a"),
    });

    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
      mainGroupChannel: "channel:feishu:oc_main_a",
    });
    db.upsertProjectLeader({
      projectId: "repo.a",
      agentName: "kai",
      capabilities: ["implementation"],
      active: true,
    });

    const handlers = createProjectHandlers(buildAgentContext(db, tempDir));
    const list = handlers["project.list"];
    const get = handlers["project.get"];

    const listResult = (await list({ token: speakerToken, limit: 10 })) as {
      projects: Array<{ id: string; leaders?: Array<{ agentName: string }> }>;
    };
    assert.equal(listResult.projects.length, 1);
    assert.equal(listResult.projects[0]?.id, "repo.a");
    assert.deepEqual(
      listResult.projects[0]?.leaders?.map((leader) => leader.agentName),
      ["kai"]
    );

    const getResult = (await get({ token: speakerToken, id: "repo.a" })) as {
      project: { id: string; speakerAgent: string; leaders?: Array<{ agentName: string }> };
    };
    assert.equal(getResult.project.id, "repo.a");
    assert.equal(getResult.project.speakerAgent, "nex");
    assert.deepEqual(
      getResult.project.leaders?.map((leader) => leader.agentName),
      ["kai"]
    );
  });
});

test("project.select-leader applies capability/busy/health ranking", async () => {
  await withTempDb(async (db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-rank");
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: projectRoot,
    });
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });
    db.registerAgent({
      name: "leo",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });
    db.registerAgent({
      name: "mila",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });
    db.registerAgent({
      name: "zoe",
      provider: "codex",
      role: "leader",
      workspace: path.join(tempDir, "repo-other"),
    });

    db.upsertProject({
      id: "repo.rank",
      name: "repo-rank",
      root: projectRoot,
      speakerAgent: "nex",
      mainGroupChannel: "channel:feishu:oc_main_rank",
    });
    db.upsertProjectLeader({
      projectId: "repo.rank",
      agentName: "kai",
      capabilities: ["implementation", "review"],
      active: true,
    });
    db.upsertProjectLeader({
      projectId: "repo.rank",
      agentName: "leo",
      capabilities: ["implementation", "review"],
      active: true,
    });
    db.upsertProjectLeader({
      projectId: "repo.rank",
      agentName: "mila",
      capabilities: ["implementation"],
      active: true,
    });
    db.upsertProjectLeader({
      projectId: "repo.rank",
      agentName: "zoe",
      capabilities: ["implementation", "review"],
      active: true,
    });

    const kaiRun = db.createAgentRun("kai", []);
    db.completeAgentRun(kaiRun.id, "ok", 100);
    const leoRun = db.createAgentRun("leo", []);
    db.completeAgentRun(leoRun.id, "ok", 120);
    const milaRun = db.createAgentRun("mila", []);
    db.failAgentRun(milaRun.id, "failed");

    const handlers = createProjectHandlers(buildAgentContext(db, tempDir, ["kai"]));
    const selectLeader = handlers["project.select-leader"];

    const result = (await selectLeader({
      token: speakerToken,
      projectId: "repo.rank",
      requiredCapabilities: ["implementation", "review"],
    })) as {
      selected?: { agentName: string; busy: boolean; agentHealth: string };
      candidates: Array<{ agentName: string }>;
      requiredCapabilities: string[];
    };

    assert.deepEqual(result.requiredCapabilities, ["implementation", "review"]);
    assert.equal(result.selected?.agentName, "leo");
    assert.equal(result.selected?.busy, false);
    assert.equal(result.selected?.agentHealth, "ok");
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.agentName),
      ["leo", "kai", "zoe"]
    );
  });
});

test("project.select-leader returns empty when no active candidate matches", async () => {
  await withTempDb(async (db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-empty");
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: projectRoot,
    });
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });

    db.upsertProject({
      id: "repo.empty",
      name: "repo-empty",
      root: projectRoot,
      speakerAgent: "nex",
    });
    db.upsertProjectLeader({
      projectId: "repo.empty",
      agentName: "kai",
      capabilities: ["implementation"],
      active: false,
    });

    const handlers = createProjectHandlers(buildAgentContext(db, tempDir));
    const selectLeader = handlers["project.select-leader"];

    const result = (await selectLeader({
      token: speakerToken,
      projectId: "repo.empty",
      requiredCapabilities: ["implementation"],
    })) as {
      selected?: { agentName: string };
      candidates: Array<{ agentName: string }>;
    };

    assert.equal(result.selected, undefined);
    assert.deepEqual(result.candidates, []);
  });
});
