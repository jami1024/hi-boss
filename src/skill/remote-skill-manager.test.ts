import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RemoteSkillError,
  getRemoteSkill,
  listRemoteSkills,
  normalizeRemoteSkillName,
  parseRemoteSkillSource,
  removeRemoteSkill,
  validateRemoteSkillPackageLimits,
  type RemoteSkillRecord,
  type RemoteSkillTarget,
} from "./remote-skill-manager.js";

function withTempDir(run: (tempDir: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-remote-skill-test-"));
  try {
    run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeMetadata(target: RemoteSkillTarget, record: RemoteSkillRecord): void {
  const skillDir = path.join(target.rootDir, record.skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# sample\n", "utf8");
  fs.writeFileSync(path.join(skillDir, ".source.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

test("normalizeRemoteSkillName validates format", () => {
  assert.equal(normalizeRemoteSkillName("Code-Review"), "code-review");
  assert.throws(() => normalizeRemoteSkillName("A"));
  assert.throws(() => normalizeRemoteSkillName("invalid name"));
});

test("parseRemoteSkillSource supports raw and blob URLs", () => {
  const raw = parseRemoteSkillSource(
    "https://raw.githubusercontent.com/acme/tooling/main/skills/code-review/SKILL.md"
  );
  assert.equal(raw.repositoryUrl, "https://github.com/acme/tooling.git");
  assert.equal(raw.sourceRef, "main");
  assert.equal(raw.sourcePath, "skills/code-review/SKILL.md");

  const blob = parseRemoteSkillSource(
    "https://github.com/acme/tooling/blob/main/skills/release-checklist",
    "refs/tags/v1.2.3"
  );
  assert.equal(blob.repositoryUrl, "https://github.com/acme/tooling.git");
  assert.equal(blob.sourceRef, "refs/tags/v1.2.3");
  assert.equal(blob.sourcePath, "skills/release-checklist");
});

test("parseRemoteSkillSource returns structured errors for insecure URL", () => {
  assert.throws(
    () => parseRemoteSkillSource("http://github.com/acme/tooling/tree/main/skills/code-review"),
    (err: unknown) => {
      if (!(err instanceof RemoteSkillError)) return false;
      return (
        err.errorCode === "insecure-source-url" &&
        typeof err.hint === "string" &&
        err.hint.length > 0
      );
    }
  );
});

test("validateRemoteSkillPackageLimits rejects file count overflow", () => {
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, "skill"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "skill", "SKILL.md"), "# demo\n", "utf8");
    fs.writeFileSync(path.join(tempDir, "skill", "a.txt"), "a", "utf8");
    fs.writeFileSync(path.join(tempDir, "skill", "b.txt"), "b", "utf8");

    assert.throws(
      () =>
        validateRemoteSkillPackageLimits(path.join(tempDir, "skill"), {
          maxFileCount: 2,
          maxSingleFileBytes: 1024,
          maxTotalBytes: 1024,
        }),
      (err: unknown) => err instanceof RemoteSkillError && err.errorCode === "skill-file-count-exceeded"
    );
  });
});

test("validateRemoteSkillPackageLimits rejects single file oversize", () => {
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, "skill"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "skill", "SKILL.md"), "# demo\n", "utf8");
    fs.writeFileSync(path.join(tempDir, "skill", "big.txt"), "0123456789ABCDEF", "utf8");

    assert.throws(
      () =>
        validateRemoteSkillPackageLimits(path.join(tempDir, "skill"), {
          maxFileCount: 10,
          maxSingleFileBytes: 8,
          maxTotalBytes: 1024,
        }),
      (err: unknown) => err instanceof RemoteSkillError && err.errorCode === "skill-file-size-exceeded"
    );
  });
});

test("validateRemoteSkillPackageLimits rejects total package oversize", () => {
  withTempDir((tempDir) => {
    fs.mkdirSync(path.join(tempDir, "skill"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "skill", "SKILL.md"), "# demo\n", "utf8");
    fs.writeFileSync(path.join(tempDir, "skill", "a.txt"), "1234567890", "utf8");
    fs.writeFileSync(path.join(tempDir, "skill", "b.txt"), "1234567890", "utf8");

    assert.throws(
      () =>
        validateRemoteSkillPackageLimits(path.join(tempDir, "skill"), {
          maxFileCount: 10,
          maxSingleFileBytes: 1024,
          maxTotalBytes: 20,
        }),
      (err: unknown) => err instanceof RemoteSkillError && err.errorCode === "skill-total-size-exceeded"
    );
  });
});

test("remote skill metadata list/get/remove works for a target root", () => {
  withTempDir((tempDir) => {
    const target: RemoteSkillTarget = {
      type: "agent",
      id: "nex",
      rootDir: path.join(tempDir, "skills"),
    };

    const record: RemoteSkillRecord = {
      skillName: "code-review",
      sourceUrl: "https://github.com/acme/tooling/tree/main/skills/code-review",
      repositoryUrl: "https://github.com/acme/tooling.git",
      sourcePath: "skills/code-review",
      sourceRef: "main",
      commit: "abc123",
      checksum: "sha256",
      fileCount: 2,
      status: "valid",
      addedAt: "2026-03-08T00:00:00.000Z",
      lastUpdated: "2026-03-08T00:00:00.000Z",
      targetType: "agent",
      targetId: "nex",
    };

    writeMetadata(target, record);

    const listed = listRemoteSkills(target);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.skillName, "code-review");

    const fetched = getRemoteSkill(target, "code-review");
    assert.equal(fetched?.sourceRef, "main");

    removeRemoteSkill(target, "code-review");
    assert.equal(listRemoteSkills(target).length, 0);
  });
});
