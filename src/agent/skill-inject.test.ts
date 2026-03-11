import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeAgentSkillFile, getAgentSkillInjectDir } from "./skill-inject.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-inject-test-"));
  try {
    // Create minimal agent directory structure.
    const agentDir = path.join(dir, "agents", "test-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("getAgentSkillInjectDir returns correct path", () => {
  const dir = getAgentSkillInjectDir("nex", "/home/user/hiboss");
  assert.ok(dir.endsWith("agents/nex/skills/_system"));
});

test("writeAgentSkillFile creates directory and files on first write", () => {
  withTempDir((hibossDir) => {
    const content = "# Test Agent\n\nYou are a test agent.";
    const result = writeAgentSkillFile({
      hibossDir,
      agentName: "test-agent",
      content,
    });

    assert.equal(result.written, true);
    assert.ok(fs.existsSync(path.join(result.dirPath, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(result.dirPath, ".content-hash")));

    const written = fs.readFileSync(path.join(result.dirPath, "CLAUDE.md"), "utf8");
    assert.equal(written, content);
  });
});

test("writeAgentSkillFile skips write when content unchanged", () => {
  withTempDir((hibossDir) => {
    const content = "# Same Content";

    const first = writeAgentSkillFile({ hibossDir, agentName: "test-agent", content });
    assert.equal(first.written, true);

    const second = writeAgentSkillFile({ hibossDir, agentName: "test-agent", content });
    assert.equal(second.written, false);
  });
});

test("writeAgentSkillFile updates file when content changes", () => {
  withTempDir((hibossDir) => {
    const first = writeAgentSkillFile({
      hibossDir,
      agentName: "test-agent",
      content: "version 1",
    });
    assert.equal(first.written, true);

    const second = writeAgentSkillFile({
      hibossDir,
      agentName: "test-agent",
      content: "version 2",
    });
    assert.equal(second.written, true);

    const written = fs.readFileSync(path.join(second.dirPath, "CLAUDE.md"), "utf8");
    assert.equal(written, "version 2");
  });
});
