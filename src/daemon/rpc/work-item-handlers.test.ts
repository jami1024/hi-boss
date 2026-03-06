import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PERMISSION_POLICY } from "../../shared/permissions.js";
import { HiBossDatabase } from "../db/database.js";
import { createWorkItemHandlers } from "./work-item-handlers.js";
import type { DaemonContext, Principal } from "./context.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-rpc-work-item-test-"));
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

  return {
    db,
    router: {} as DaemonContext["router"],
    executor: {} as DaemonContext["executor"],
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
  };
}

test("work-item.update allows leader add/remove channel allowlist", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: leaderToken } = db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
    });
    db.upsertWorkItem({ id: "req-rpc-1", state: "new" });

    const handlers = createWorkItemHandlers(buildAgentContext(db, tempDir));
    const update = handlers["work-item.update"];

    const first = (await update({
      token: leaderToken,
      id: "req-rpc-1",
      addChannels: [
        "channel:feishu:oc_main",
        "channel:feishu:oc_requirements",
      ],
    })) as { item: { channelAllowlist?: string[] } };

    assert.deepEqual(first.item.channelAllowlist, [
      "channel:feishu:oc_main",
      "channel:feishu:oc_requirements",
    ]);
    assert.equal(db.isWorkItemChannelAllowlistStrict("req-rpc-1"), true);

    const second = (await update({
      token: leaderToken,
      id: "req-rpc-1",
      removeChannels: ["channel:feishu:oc_requirements"],
    })) as { item: { channelAllowlist?: string[] } };

    assert.deepEqual(second.item.channelAllowlist, [
      "channel:feishu:oc_main",
    ]);
    assert.equal(db.isWorkItemChannelAllowlistStrict("req-rpc-1"), true);

    await update({
      token: leaderToken,
      id: "req-rpc-1",
      removeChannels: ["channel:feishu:oc_main"],
    });

    assert.deepEqual(db.listChannelAddressesForWorkItem("req-rpc-1"), []);
    assert.equal(db.isWorkItemChannelAllowlistStrict("req-rpc-1"), true);
  });
});

test("work-item.update rejects speaker channel allowlist mutation", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: speakerToken } = db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.upsertWorkItem({ id: "req-rpc-2", state: "new" });

    const handlers = createWorkItemHandlers(buildAgentContext(db, tempDir));
    const update = handlers["work-item.update"];

    await assert.rejects(
      () =>
        update({
          token: speakerToken,
          id: "req-rpc-2",
          addChannels: ["channel:feishu:oc_main"],
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        const code = (err as Error & { code?: number }).code;
        return code === -32001 && err.message.includes("Only leader role can modify work item channel allowlist");
      }
    );
  });
});

test("work-item.get and work-item.list include channel allowlist", async () => {
  await withTempDb(async (db, tempDir) => {
    const { token: leaderToken } = db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
    });
    db.upsertWorkItem({ id: "req-rpc-3", state: "new", title: "demo" });
    db.addChannelAddressToWorkItemAllowlist({
      workItemId: "req-rpc-3",
      channelAddress: "channel:feishu:oc_main",
      createdByAgent: "kai",
    });

    const handlers = createWorkItemHandlers(buildAgentContext(db, tempDir));
    const get = handlers["work-item.get"];
    const list = handlers["work-item.list"];

    const getResult = (await get({
      token: leaderToken,
      id: "req-rpc-3",
    })) as { item: { channelAllowlist?: string[] } };
    assert.deepEqual(getResult.item.channelAllowlist, ["channel:feishu:oc_main"]);

    const listResult = (await list({ token: leaderToken, limit: 10 })) as {
      items: Array<{ id: string; channelAllowlist?: string[] }>;
    };
    const target = listResult.items.find((item) => item.id === "req-rpc-3");
    assert.ok(target);
    assert.deepEqual(target?.channelAllowlist, ["channel:feishu:oc_main"]);
  });
});
