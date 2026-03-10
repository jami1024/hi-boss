import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../daemon/db/database.js";
import { resolveSessionRefreshTargetForAgent } from "./executor.js";

function withTempDb(run: (db: HiBossDatabase) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-executor-refresh-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  try {
    run(db);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("resolveSessionRefreshTargetForAgent falls back to agent scope without DB", () => {
  const target = resolveSessionRefreshTargetForAgent({
    db: null,
    agentName: "nex",
  });
  assert.equal(target, "nex");
});

test("resolveSessionRefreshTargetForAgent falls back to agent scope without running run", () => {
  withTempDb((db) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    const target = resolveSessionRefreshTargetForAgent({
      db,
      agentName: "nex",
    });
    assert.equal(target, "nex");
  });
});

test("resolveSessionRefreshTargetForAgent selects project-scoped session key from running run", () => {
  withTempDb((db) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    const env = db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "hello" },
      metadata: { projectId: "prj-a" },
    });
    db.createAgentRun("nex", [env.id]);

    const target = resolveSessionRefreshTargetForAgent({
      db,
      agentName: "nex",
    });
    assert.equal(target, "nex:prj-a");
  });
});

test("resolveSessionRefreshTargetForAgent falls back when running run has conflicting projects", () => {
  withTempDb((db) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    const envA = db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "a" },
      metadata: { projectId: "prj-a" },
    });
    const envB = db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "b" },
      metadata: { projectId: "prj-b" },
    });
    db.createAgentRun("nex", [envA.id, envB.id]);

    const target = resolveSessionRefreshTargetForAgent({
      db,
      agentName: "nex",
    });
    assert.equal(target, "nex");
  });
});
