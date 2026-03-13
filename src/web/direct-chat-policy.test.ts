import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../daemon/db/database.js";
import { validateDirectChatTarget } from "./direct-chat-policy.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-chat-policy-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  try {
    run(db, tempDir);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("validateDirectChatTarget rejects leader agent", () => {
  withTempDb((db) => {
    const leader = db.registerAgent({ name: "kai", provider: "codex", role: "leader" }).agent;
    const result = validateDirectChatTarget(db, leader);
    assert.ok(result !== null, "should block direct chat");
    assert.ok(result.includes("not allowed"), result);
  });
});

test("validateDirectChatTarget rejects project-bound speaker", () => {
  withTempDb((db, tempDir) => {
    const speaker = db.registerAgent({ name: "nex", provider: "codex", role: "speaker" }).agent;
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: speaker.name,
    });
    const result = validateDirectChatTarget(db, speaker);
    assert.ok(result !== null, "should block direct chat");
    assert.ok(result.includes("not allowed"), result);
  });
});

test("validateDirectChatTarget rejects unbound speaker", () => {
  withTempDb((db) => {
    const speaker = db.registerAgent({ name: "free", provider: "codex", role: "speaker" }).agent;
    const result = validateDirectChatTarget(db, speaker);
    assert.ok(result !== null, "should block direct chat");
    assert.ok(result.includes("not allowed"), result);
  });
});
