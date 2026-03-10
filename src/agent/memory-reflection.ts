/**
 * Memory reflection support for periodic consolidation of daily memories
 * into long-term MEMORY.md.
 *
 * Provides helpers that build a reflection prompt context and detect
 * reflection envelopes so the executor can handle them appropriately.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logEvent, errorMessage } from "../shared/daemon-log.js";
import {
  DEFAULT_MEMORY_LONGTERM_MAX_CHARS,
  DEFAULT_MEMORY_SHORTTERM_PER_DAY_MAX_CHARS,
} from "../shared/defaults.js";

const DAILY_MEMORY_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;
const DEFAULT_REFLECTION_REVIEW_DAYS = 7;

function getAgentInternalSpaceDir(hibossDir: string, agentName: string): string {
  return path.join(hibossDir, "agents", agentName, "internal_space");
}

export interface ReflectionContext {
  /** Current content of MEMORY.md. */
  currentMemory: string;
  /** Current size of MEMORY.md in characters. */
  currentMemoryLength: number;
  /** Maximum allowed characters for MEMORY.md. */
  maxMemoryChars: number;
  /** Daily memory entries to review (newest first). */
  dailyEntries: { date: string; content: string }[];
  /** Number of days reviewed. */
  reviewDays: number;
}

/**
 * Build the context needed for a reflection task.
 *
 * Reads the current MEMORY.md and recent daily memory files
 * so the agent can consolidate useful information.
 */
export function buildReflectionContext(params: {
  hibossDir: string;
  agentName: string;
  reviewDays?: number;
}): ReflectionContext {
  const reviewDays = params.reviewDays ?? DEFAULT_REFLECTION_REVIEW_DAYS;
  const spaceDir = getAgentInternalSpaceDir(params.hibossDir, params.agentName);

  // Read current MEMORY.md
  let currentMemory = "";
  const memoryPath = path.join(spaceDir, "MEMORY.md");
  try {
    if (fs.existsSync(memoryPath)) {
      const stat = fs.statSync(memoryPath);
      if (stat.isFile()) {
        currentMemory = fs.readFileSync(memoryPath, "utf8").trim();
      }
    }
  } catch {
    // Best-effort
  }

  // Read daily files for review window
  const dailyDir = path.join(spaceDir, "memories");
  const dailyEntries: { date: string; content: string }[] = [];
  try {
    if (fs.existsSync(dailyDir) && fs.statSync(dailyDir).isDirectory()) {
      const files = fs
        .readdirSync(dailyDir)
        .filter((name) => DAILY_MEMORY_FILENAME_REGEX.test(name))
        .sort()
        .reverse()
        .slice(0, reviewDays);

      for (const filename of files) {
        const filePath = path.join(dailyDir, filename);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;
          let content = fs.readFileSync(filePath, "utf8").trim();
          if (content.length > DEFAULT_MEMORY_SHORTTERM_PER_DAY_MAX_CHARS) {
            content = content.slice(0, DEFAULT_MEMORY_SHORTTERM_PER_DAY_MAX_CHARS);
          }
          if (content) {
            dailyEntries.push({ date: filename.replace(/\.md$/, ""), content });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Best-effort
  }

  return {
    currentMemory,
    currentMemoryLength: currentMemory.length,
    maxMemoryChars: DEFAULT_MEMORY_LONGTERM_MAX_CHARS,
    dailyEntries,
    reviewDays,
  };
}

/**
 * Build a reflection prompt that can be sent as an envelope to an agent.
 *
 * The prompt instructs the agent to review recent daily memories and
 * consolidate valuable information into MEMORY.md.
 */
export function buildReflectionPrompt(context: ReflectionContext): string {
  const sections: string[] = [
    "## Memory Reflection Task",
    "",
    "Review your recent daily memories and update your long-term memory (MEMORY.md).",
    "",
    "### Instructions",
    "1. Read through the daily memories below",
    "2. Identify patterns, preferences, decisions, and facts worth preserving long-term",
    "3. Update MEMORY.md: add valuable insights, remove outdated entries",
    "4. Keep MEMORY.md compact and high-value (do NOT copy raw transcripts)",
    "5. After updating, briefly summarize what you changed",
    "",
    `### Current MEMORY.md Status`,
    `- Size: ${context.currentMemoryLength} / ${context.maxMemoryChars} chars`,
    `- Usage: ${Math.round((context.currentMemoryLength / context.maxMemoryChars) * 100)}%`,
    "",
  ];

  if (context.dailyEntries.length === 0) {
    sections.push("### Daily Memories to Review");
    sections.push("(no daily memories found in the review window)");
  } else {
    sections.push(`### Daily Memories to Review (last ${context.reviewDays} days)`);
    sections.push("");
    for (const entry of context.dailyEntries) {
      sections.push(`--- ${entry.date} ---`);
      sections.push(entry.content);
      sections.push("");
    }
  }

  return sections.join("\n");
}

/**
 * Check if an envelope is a reflection task (sent by the system scheduler).
 */
export function isReflectionEnvelope(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const m = metadata as Record<string, unknown>;
  return m.source === "memory-reflection";
}
