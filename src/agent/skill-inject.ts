/**
 * Skill inject: writes stable system instructions to an agent's
 * skills/_system/CLAUDE.md so Claude Code loads them via --add-dir.
 *
 * This avoids sending the full (static) system prompt on every turn
 * via --append-system-prompt — only dynamic content is passed inline.
 *
 * Codex does not support this mechanism; it continues to receive the
 * full system prompt via -c developer_instructions=...
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getAgentDir } from "./home-setup.js";

const SYSTEM_SKILL_DIR = "skills/_system";
const SKILL_FILE_NAME = "CLAUDE.md";
const HASH_FILE_NAME = ".content-hash";

/**
 * Get the skills/_system directory path for an agent.
 */
export function getAgentSkillInjectDir(agentName: string, hibossDir: string): string {
  return path.join(getAgentDir(agentName, hibossDir), SYSTEM_SKILL_DIR);
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Write the stable system instructions to the agent's skills/_system/CLAUDE.md.
 *
 * Uses a content hash to skip writes when the content hasn't changed.
 * Returns the directory path (for use as --add-dir target).
 */
export function writeAgentSkillFile(params: {
  hibossDir: string;
  agentName: string;
  content: string;
}): { dirPath: string; written: boolean } {
  const dirPath = getAgentSkillInjectDir(params.agentName, params.hibossDir);
  const filePath = path.join(dirPath, SKILL_FILE_NAME);
  const hashPath = path.join(dirPath, HASH_FILE_NAME);

  const newHash = contentHash(params.content);

  // Check existing hash to avoid unnecessary writes.
  try {
    const existingHash = fs.readFileSync(hashPath, "utf8").trim();
    if (existingHash === newHash) {
      return { dirPath, written: false };
    }
  } catch {
    // Hash file doesn't exist yet — proceed to write.
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, params.content, "utf8");
  fs.writeFileSync(hashPath, newHash, "utf8");

  return { dirPath, written: true };
}
