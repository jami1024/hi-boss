/**
 * Automatic memory extraction from completed agent turns.
 *
 * Extracts key information from turn results and appends to the agent's
 * daily memory file. Uses rule-based extraction (no LLM calls) for zero
 * extra token cost and zero latency.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Envelope } from "../envelope/types.js";
import type { OnTurnCompleteParams, TurnTokenUsage } from "./executor-support.js";
import { logEvent, errorMessage } from "../shared/daemon-log.js";
import { DEFAULT_MEMORY_SHORTTERM_PER_DAY_MAX_CHARS } from "../shared/defaults.js";
import { formatShortId } from "../shared/id-format.js";

const DAILY_MEMORIES_DIRNAME = "memories";
const MAX_ENTRY_LENGTH = 200;
const MAX_RESPONSE_SUMMARY_LENGTH = 120;

function getAgentDailyMemoriesDir(hibossDir: string, agentName: string): string {
  return path.join(hibossDir, "agents", agentName, "internal_space", DAILY_MEMORIES_DIRNAME);
}

function getTodayFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}.md`;
}

function summarizeEnvelopes(envelopes: Envelope[]): string {
  if (envelopes.length === 0) return "";

  const senders = new Set<string>();
  for (const env of envelopes) {
    const from = env.from.trim();
    if (from) senders.add(from);
  }

  const senderList = [...senders].map((s) => {
    // Simplify "agent:nex" -> "nex", "channel:telegram:123" -> "telegram"
    const parts = s.split(":");
    return parts.length >= 2 ? parts[1] : s;
  });

  return `processed ${envelopes.length} envelope(s) from ${senderList.join(", ")}`;
}

function summarizeResponse(response: string): string {
  if (!response.trim()) return "";

  // Extract first meaningful line as summary
  const lines = response.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return "";

  // Look for action indicators in the response
  const actionPatterns = [
    { pattern: /hiboss envelope send/, label: "sent envelope" },
    { pattern: /hiboss reaction set/, label: "set reaction" },
    { pattern: /hiboss cron create/, label: "created cron schedule" },
  ];

  const actions: string[] = [];
  for (const { pattern, label } of actionPatterns) {
    if (pattern.test(response)) {
      actions.push(label);
    }
  }

  if (actions.length > 0) {
    return `actions: ${actions.join(", ")}`;
  }

  // Fall back to first line truncated
  const firstLine = lines[0];
  if (firstLine.length <= MAX_RESPONSE_SUMMARY_LENGTH) return firstLine;
  return `${firstLine.slice(0, MAX_RESPONSE_SUMMARY_LENGTH)}...`;
}

/**
 * Extract a concise memory entry from a completed turn.
 * Returns null if no useful memory can be extracted.
 */
export function extractTurnMemoryEntry(params: {
  agentName: string;
  envelopes: Envelope[];
  response: string;
}): string | null {
  const envelopeSummary = summarizeEnvelopes(params.envelopes);
  const responseSummary = summarizeResponse(params.response);

  if (!envelopeSummary && !responseSummary) return null;

  const parts: string[] = [];
  if (envelopeSummary) parts.push(envelopeSummary);
  if (responseSummary) parts.push(responseSummary);

  const entry = parts.join(" -> ");
  if (entry.length > MAX_ENTRY_LENGTH) {
    return `${entry.slice(0, MAX_ENTRY_LENGTH)}...`;
  }
  return entry;
}

/**
 * Append a memory entry to the agent's daily memory file.
 * Respects the per-day max chars limit. Returns true on success.
 */
export function appendDailyMemoryEntry(params: {
  hibossDir: string;
  agentName: string;
  entry: string;
}): boolean {
  try {
    const dir = getAgentDailyMemoriesDir(params.hibossDir, params.agentName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filename = getTodayFilename();
    const filePath = path.join(dir, filename);

    let existing = "";
    if (fs.existsSync(filePath)) {
      existing = fs.readFileSync(filePath, "utf8");
    }

    // Check size budget
    const newContent = existing
      ? `${existing.trimEnd()}\n${params.entry}\n`
      : `${params.entry}\n`;

    if (newContent.length > DEFAULT_MEMORY_SHORTTERM_PER_DAY_MAX_CHARS) {
      return false; // Budget exhausted for today
    }

    fs.writeFileSync(filePath, newContent, "utf8");
    return true;
  } catch (err) {
    logEvent("warn", "memory-extractor-append-failed", {
      "agent-name": params.agentName,
      error: errorMessage(err),
    });
    return false;
  }
}

/**
 * Record a session refresh event to the agent's daily memory.
 */
export function appendSessionRefreshNote(params: {
  hibossDir: string;
  agentName: string;
  reason?: string;
  sessionCreatedAtMs?: number;
  lastRunAtMs?: number;
}): void {
  const parts = ["[session-refresh]"];
  if (params.reason) parts.push(`reason: ${params.reason}`);
  const entry = parts.join(" ");
  appendDailyMemoryEntry({
    hibossDir: params.hibossDir,
    agentName: params.agentName,
    entry,
  });
}

/**
 * The afterTurn handler: extracts and persists memory from a completed turn.
 * Designed to be wired into the executor's onTurnComplete callback.
 */
export function handleTurnComplete(params: OnTurnCompleteParams): void {
  const entry = extractTurnMemoryEntry({
    agentName: params.agentName,
    envelopes: params.envelopes,
    response: params.response,
  });

  if (!entry) return;

  appendDailyMemoryEntry({
    hibossDir: params.hibossDir,
    agentName: params.agentName,
    entry,
  });
}
