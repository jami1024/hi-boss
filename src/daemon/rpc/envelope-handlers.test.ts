import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PERMISSION_POLICY } from "../../shared/permissions.js";
import { MessageRouter } from "../router/message-router.js";
import { HiBossDatabase } from "../db/database.js";
import { createEnvelopeHandlers } from "./envelope-handlers.js";
import { normalizeWorkspacePath } from "./work-item-orchestration.js";
import type { DaemonContext, Principal } from "./context.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-rpc-envelope-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildAgentContext(db: HiBossDatabase, tempDir: string): DaemonContext {
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

  const router = new MessageRouter(db);

  return {
    db,
    router,
    executor: {} as DaemonContext["executor"],
    scheduler: {
      onEnvelopeCreated: () => undefined,
    } as unknown as DaemonContext["scheduler"],
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

test("envelope.send seeds allowlist for a new work-item channel send", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", "bind-token-nex");

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    const result = (await send({
      token: speakerToken,
      to: "channel:feishu:oc_main",
      text: "seed ch1",
      workItemId: "req-env-rpc-1",
      deliverAt: "+1h",
    })) as { id: string };

    assert.ok(typeof result.id === "string" && result.id.length > 0);
    assert.ok(db.getWorkItemById("req-env-rpc-1"));
    assert.deepEqual(db.listChannelAddressesForWorkItem("req-env-rpc-1"), [
      "channel:feishu:oc_main",
    ]);
  });
});

test("envelope.send blocks speaker when strict allowlist is enabled and empty", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", "bind-token-nex");

    db.upsertWorkItem({
      id: "req-env-rpc-2",
      state: "new",
    });
    db.setWorkItemChannelAllowlistStrict("req-env-rpc-2", true);

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    await assert.rejects(
      () =>
        send({
          token: speakerToken,
          to: "channel:feishu:oc_main",
          text: "should fail",
          workItemId: "req-env-rpc-2",
          deliverAt: "+1h",
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const code = (err as Error & { code?: number }).code;
        return code === -32001 && err.message.includes("Channel destination not allowed for work item 'req-env-rpc-2'");
      }
    );

    assert.deepEqual(db.listChannelAddressesForWorkItem("req-env-rpc-2"), []);
  });
});

test("envelope.send inherits work-item-id from reply-to envelope when omitted", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", "bind-token-nex");

    const upstream = db.createEnvelope({
      from: "channel:feishu:oc_source",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "please continue this requirement" },
      metadata: {
        workItemId: "req-env-rpc-inherit",
      },
    });

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    const result = (await send({
      token: speakerToken,
      to: "channel:feishu:oc_main",
      text: "forwarded with inherited work-item",
      replyToEnvelopeId: upstream.id,
      deliverAt: "+1h",
    })) as { id: string };

    const created = db.getEnvelopeById(result.id);
    assert.ok(created);
    assert.equal((created?.metadata as Record<string, unknown> | undefined)?.workItemId, "req-env-rpc-inherit");
    assert.ok(db.getWorkItemById("req-env-rpc-inherit"));
    assert.deepEqual(db.listChannelAddressesForWorkItem("req-env-rpc-inherit"), [
      "channel:feishu:oc_main",
    ]);
  });
});

test("envelope.send speaker delegation captures project context and specialist assignment", async () => {
  await withTempDb(async (db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-a");
    const normalizedProjectRoot = normalizeWorkspacePath(projectRoot);
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: path.join(tempDir, "speaker-home"),
    });
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });

    const upstream = db.createEnvelope({
      from: "channel:feishu:oc_main",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "new requirement" },
    });

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    await send({
      token: speakerToken,
      to: "agent:kai",
      text: `project-root: ${projectRoot}\nplease execute`,
      workItemId: "req-env-rpc-delegate",
      replyToEnvelopeId: upstream.id,
    });

    const item = db.getWorkItemById("req-env-rpc-delegate");
    assert.ok(item);
    assert.equal(item?.projectRoot, normalizedProjectRoot);
    assert.equal(item?.orchestratorAgent, "nex");
    assert.equal(item?.mainGroupChannel, "channel:feishu:oc_main");
    assert.deepEqual(item?.specialists, ["kai"]);
  });
});

test("envelope.send requires specialist leader updates to reply delegated envelope", async () => {
  await withTempDb(async (db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-b");
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: path.join(tempDir, "speaker-home"),
    });
    const { token: leaderToken } = db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });

    const upstream = db.createEnvelope({
      from: "channel:feishu:oc_main",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "new requirement" },
    });

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    await send({
      token: speakerToken,
      to: "agent:kai",
      text: `project-root: ${projectRoot}\nplease execute`,
      workItemId: "req-env-rpc-specialist",
      replyToEnvelopeId: upstream.id,
    });

    await assert.rejects(
      () =>
        send({
          token: leaderToken,
          to: "agent:nex",
          text: "I have progress",
          workItemId: "req-env-rpc-specialist",
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const code = (err as Error & { code?: number }).code;
        return code === -32602 && err.message.includes("Specialist leader updates require --reply-to delegated envelope");
      }
    );
  });
});

test("envelope.send rejects cross-project reply-to for different work-item ids", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: path.join(tempDir, "speaker-home"),
    });

    db.upsertWorkItem({
      id: "req-project-a",
      state: "new",
      projectId: "prj-a",
      projectRoot: path.join(tempDir, "a"),
      orchestratorAgent: "nex",
      actor: "nex",
      reason: "seed-a",
    });
    db.upsertWorkItem({
      id: "req-project-b",
      state: "new",
      projectId: "prj-b",
      projectRoot: path.join(tempDir, "b"),
      orchestratorAgent: "nex",
      actor: "nex",
      reason: "seed-b",
    });

    const upstream = db.createEnvelope({
      from: "agent:nex",
      to: "agent:nex",
      content: { text: "upstream" },
      metadata: { workItemId: "req-project-a" },
    });

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    await assert.rejects(
      () =>
        send({
          token: speakerToken,
          to: "agent:nex",
          text: "cross project update",
          workItemId: "req-project-b",
          replyToEnvelopeId: upstream.id,
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const code = (err as Error & { code?: number }).code;
        return code === -32602 && err.message.includes("Cross-project reply-to is not allowed");
      }
    );
  });
});

test("envelope.send blocks unassigned leader from project-scoped work item", async () => {
  await withTempDb(async (db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-c");
    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: path.join(tempDir, "speaker-home"),
    });
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });
    const { token: leoToken } = db.registerAgent({
      name: "leo",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });

    db.upsertWorkItem({
      id: "req-project-membership",
      state: "in-progress",
      projectRoot,
      orchestratorAgent: "nex",
      actor: "nex",
      reason: "seed-membership",
    });
    db.upsertWorkItemSpecialistAssignment({
      workItemId: "req-project-membership",
      agentName: "kai",
      assignedBy: "nex",
    });

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    await assert.rejects(
      () =>
        send({
          token: leoToken,
          to: "agent:nex",
          text: "unauthorized progress",
          workItemId: "req-project-membership",
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const code = (err as Error & { code?: number }).code;
        return code === -32001 && err.message.includes("Agent is not a member of this work item project context");
      }
    );
  });
});

test("envelope.send requires speaker to rebind project-scoped item when orchestrator is missing", async () => {
  await withTempDb(async (db, tempDir) => {
    const projectRoot = path.join(tempDir, "repo-d");
    const { token: leaderToken } = db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: projectRoot,
    });

    db.upsertWorkItem({
      id: "req-project-orphan",
      state: "in-progress",
      projectRoot,
      actor: "seed",
      reason: "seed-orphan",
    });

    const handlers = createEnvelopeHandlers(buildAgentContext(db, tempDir));
    const send = handlers["envelope.send"];

    await assert.rejects(
      () =>
        send({
          token: leaderToken,
          to: "agent:kai",
          text: "attempt update",
          workItemId: "req-project-orphan",
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const code = (err as Error & { code?: number }).code;
        return code === -32001 && err.message.includes("orchestrator is not initialized");
      }
    );
  });
});
