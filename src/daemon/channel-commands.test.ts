import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentExecutor } from "../agent/executor.js";
import type { ChannelCommand } from "../adapters/types.js";
import { HiBossDatabase } from "./db/database.js";
import { createChannelCommandHandler } from "./channel-commands.js";

type RefreshCall = {
  agentName: string;
  reason: string;
  scope?: "agent" | "auto-project" | "project";
  projectId?: string;
};

type EnrichedCommand = ChannelCommand & { agentName?: string; platform?: string };

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-channel-command-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function createExecutorStub(calls: RefreshCall[]): AgentExecutor {
  return {
    isAgentBusy: () => false,
    abortCurrentRun: () => false,
    requestSessionRefresh: (
      agentName: string,
      reason: string,
      scope?: "agent" | "auto-project" | "project",
      projectId?: string
    ) => {
      calls.push({ agentName, reason, scope, projectId });
    },
  } as unknown as AgentExecutor;
}

function makeNewCommand(agentName: string, args = "", platform = "telegram", chatId = "group-1"): EnrichedCommand {
  return {
    command: "new",
    args,
    chatId,
    authorUsername: "boss",
    agentName,
    platform,
  };
}

test("/new without projectId uses auto-project refresh", async () => {
  await withTempDb(async (db) => {
    const calls: RefreshCall[] = [];
    const handler = createChannelCommandHandler({
      db,
      executor: createExecutorStub(calls),
    });

    const result = handler(makeNewCommand("nex"));
    assert.deepEqual(result, { text: "Session refresh requested." });
    assert.deepEqual(calls, [
      {
        agentName: "nex",
        reason: "telegram:/new",
        scope: "auto-project",
        projectId: undefined,
      },
    ]);
  });
});

test("/new <projectId> triggers project-scoped refresh when agent is project member", async () => {
  await withTempDb(async (db, tempDir) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
    });

    const calls: RefreshCall[] = [];
    const handler = createChannelCommandHandler({
      db,
      executor: createExecutorStub(calls),
    });

    const result = handler(makeNewCommand("nex", " REPO.A "));
    assert.deepEqual(result, { text: "Session refresh requested." });
    assert.deepEqual(calls, [
      {
        agentName: "nex",
        reason: "telegram:/new",
        scope: "project",
        projectId: "repo.a",
      },
    ]);
  });
});

test("/new <projectId> rejects malformed project id", async () => {
  await withTempDb(async (db) => {
    const calls: RefreshCall[] = [];
    const handler = createChannelCommandHandler({
      db,
      executor: createExecutorStub(calls),
    });

    const result = handler(makeNewCommand("nex", "Bad Project"));
    assert.deepEqual(result, {
      text: "error: Invalid project-id (expected lowercase letters/numbers with optional . _ : -)",
    });
    assert.deepEqual(calls, []);
  });
});

test("/new <projectId> rejects when agent is not bound to the project", async () => {
  await withTempDb(async (db, tempDir) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "other", provider: "codex", role: "speaker" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "other",
    });

    const calls: RefreshCall[] = [];
    const handler = createChannelCommandHandler({
      db,
      executor: createExecutorStub(calls),
    });

    const result = handler(makeNewCommand("nex", "repo.a"));
    assert.deepEqual(result, {
      text: "error: Agent 'nex' is not bound to project 'repo.a'",
    });
    assert.deepEqual(calls, []);
  });
});

test("/new <projectId> stores channel project context for subsequent chat messages", async () => {
  await withTempDb(async (db, tempDir) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
    });

    const calls: RefreshCall[] = [];
    const handler = createChannelCommandHandler({
      db,
      executor: createExecutorStub(calls),
    });

    const result = handler(makeNewCommand("nex", "repo.a", "telegram", "grp-42"));
    assert.deepEqual(result, { text: "Session refresh requested." });
    assert.equal(db.getConfig("channel_project_context:telegram:grp-42:nex"), "repo.a");
  });
});

test("/new without projectId clears channel project context pin", async () => {
  await withTempDb(async (db) => {
    db.setConfig("channel_project_context:telegram:grp-42:nex", "repo.a");

    const calls: RefreshCall[] = [];
    const handler = createChannelCommandHandler({
      db,
      executor: createExecutorStub(calls),
    });

    const result = handler(makeNewCommand("nex", "", "telegram", "grp-42"));
    assert.deepEqual(result, { text: "Session refresh requested." });
    assert.equal(db.getConfig("channel_project_context:telegram:grp-42:nex"), "");
  });
});
