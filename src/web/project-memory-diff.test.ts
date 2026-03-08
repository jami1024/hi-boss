import assert from "node:assert/strict";
import test from "node:test";
import { computeProjectMemoryDiff } from "../../web/src/lib/project-memory-diff.js";

test("computeProjectMemoryDiff reports add/remove counts", () => {
  const result = computeProjectMemoryDiff(
    ["alpha", "beta", "gamma"].join("\n"),
    ["alpha", "beta-updated", "gamma", "delta"].join("\n")
  );

  assert.equal(result.added, 2);
  assert.equal(result.removed, 1);
  assert.equal(result.truncated, false);
  assert.ok(result.lines.some((line) => line.type === "remove" && line.text === "beta"));
  assert.ok(result.lines.some((line) => line.type === "add" && line.text === "beta-updated"));
  assert.ok(result.lines.some((line) => line.type === "add" && line.text === "delta"));
});

test("computeProjectMemoryDiff marks truncated for oversized input", () => {
  const before = Array.from({ length: 450 }, (_, index) => `before-${index}`).join("\n");
  const after = Array.from({ length: 450 }, (_, index) => `after-${index}`).join("\n");
  const result = computeProjectMemoryDiff(before, after, 100);

  assert.equal(result.truncated, true);
  assert.ok(result.lines.length > 0);
});
