import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateSystemInstructions } from "./instruction-generator.js";

test("generateSystemInstructions applies runtime workspace override and additional context", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-instructions-test-"));
  try {
    const output = generateSystemInstructions({
      agent: {
        name: "nex",
        token: "agent-token",
        provider: "codex",
        workspace: "/workspace/default",
        createdAt: Date.now(),
        metadata: { role: "speaker" },
      },
      agentToken: "agent-token",
      bindings: [],
      hibossDir: tempDir,
      runtimeWorkspace: "/workspace/project-a",
      additionalContext: "## project-context\nproject-id: prj-a",
    });

    assert.match(output, /\*\*Workspace\*\*: \/workspace\/project-a/);
    assert.match(output, /## Additional Context/);
    assert.match(output, /project-id: prj-a/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("generateSystemInstructions injects agent remote skill summaries", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-instructions-skill-test-"));
  try {
    const skillDir = path.join(tempDir, "agents", "nex", "skills", "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: code-review",
        "---",
        "# code-review",
        "Review code changes and report risks.",
        "",
      ].join("\n"),
      "utf8"
    );

    const output = generateSystemInstructions({
      agent: {
        name: "nex",
        token: "agent-token",
        provider: "codex",
        workspace: "/workspace/default",
        createdAt: Date.now(),
        metadata: { role: "speaker" },
      },
      agentToken: "agent-token",
      bindings: [],
      hibossDir: tempDir,
    });

    assert.match(output, /## Additional Context/);
    assert.match(output, /## agent-remote-skills/);
    assert.match(output, /- code-review: Review code changes and report risks\./);
    assert.doesNotMatch(output, /- code-review: ---/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
