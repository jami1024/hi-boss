import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveTitleFromEntryName,
  formatDateTag,
  normalizeMemoryTitle,
  suggestVersionedMemoryEntryName,
} from "../../web/src/lib/project-memory-utils.js";

test("normalizeMemoryTitle keeps stable kebab-case slug", () => {
  assert.equal(normalizeMemoryTitle("  API Review / Phase_1  "), "api-review-phase-1");
  assert.equal(normalizeMemoryTitle("***"), "notes");
});

test("deriveTitleFromEntryName strips date and version suffix", () => {
  assert.equal(deriveTitleFromEntryName("2026-03-08-decision-record-v3.md"), "decision-record");
  assert.equal(deriveTitleFromEntryName("notes.md"), "notes");
});

test("suggestVersionedMemoryEntryName increments existing version", () => {
  const date = new Date(2026, 2, 8);
  const result = suggestVersionedMemoryEntryName({
    existingNames: [
      "2026-03-08-decision-record-v1.md",
      "2026-03-08-decision-record-v2.md",
      "2026-03-08-other-v1.md",
    ],
    title: "Decision Record",
    date,
  });
  assert.equal(formatDateTag(date), "2026-03-08");
  assert.equal(result, "2026-03-08-decision-record-v3.md");
});
