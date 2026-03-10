/**
 * Project-level shared memory write support.
 *
 * Provides a structured write protocol for agents to contribute
 * shared memory entries to a project's `.hiboss/memory/` directory,
 * with conflict-safe atomic writes and author tracking.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logEvent, errorMessage } from "../shared/daemon-log.js";

const MAX_TITLE_LENGTH = 80;
const MAX_CONTENT_LENGTH = 6_000;

function sanitizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TITLE_LENGTH);
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface ProjectMemoryWriteResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Write a memory entry to a project's shared `.hiboss/memory/` directory.
 *
 * File naming: `YYYY-MM-DD-<agent>-<title>.md`
 * Content header includes author and timestamp metadata.
 * Uses atomic write (temp file + rename) to avoid partial writes.
 */
export function writeProjectMemoryEntry(params: {
  projectRoot: string;
  agentName: string;
  title: string;
  content: string;
}): ProjectMemoryWriteResult {
  try {
    const memoryDir = path.join(params.projectRoot, ".hiboss", "memory");
    fs.mkdirSync(memoryDir, { recursive: true });

    const sanitized = sanitizeTitle(params.title);
    if (!sanitized) {
      return { ok: false, error: "Title is empty after sanitization" };
    }

    const dateStr = getTodayDateString();
    const filename = `${dateStr}-${params.agentName}-${sanitized}.md`;
    const filePath = path.join(memoryDir, filename);

    // Truncate content if needed
    let content = params.content;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[...truncated...]`;
    }

    // Prepend metadata header
    const header = [
      "---",
      `author: ${params.agentName}`,
      `created: ${new Date().toISOString()}`,
      "---",
      "",
    ].join("\n");

    const fullContent = header + content + "\n";

    // Atomic write: write to temp file, then rename
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, fullContent, "utf8");
    fs.renameSync(tmpPath, filePath);

    logEvent("info", "project-memory-write", {
      "project-root": params.projectRoot,
      "agent-name": params.agentName,
      filename,
    });

    return { ok: true, path: filePath };
  } catch (err) {
    const errMsg = errorMessage(err);
    logEvent("warn", "project-memory-write-failed", {
      "project-root": params.projectRoot,
      "agent-name": params.agentName,
      error: errMsg,
    });
    return { ok: false, error: errMsg };
  }
}
