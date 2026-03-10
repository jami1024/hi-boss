/**
 * Turn-level memory recall: keyword-based retrieval of relevant memory
 * fragments for dynamic prompt assembly.
 *
 * Searches across MEMORY.md and a broader daily memory window (default 14 days)
 * to find content relevant to the current turn's envelopes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Envelope } from "../envelope/types.js";
import {
  DEFAULT_MEMORY_RECALL_MAX_CHARS,
  DEFAULT_MEMORY_RECALL_SEARCH_DAYS,
} from "../shared/defaults.js";
import { logEvent, errorMessage } from "../shared/daemon-log.js";

const DAILY_MEMORY_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;
const MIN_KEYWORD_LENGTH = 2;
const MAX_KEYWORDS = 20;

function getAgentInternalSpaceDir(hibossDir: string, agentName: string): string {
  return path.join(hibossDir, "agents", agentName, "internal_space");
}

/**
 * Extract meaningful keywords from envelope texts.
 * Strips common stop words and short tokens.
 */
function extractKeywords(envelopes: Envelope[]): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
    "my", "your", "his", "its", "our", "their",
    "this", "that", "these", "those", "what", "which", "who", "whom",
    "and", "or", "but", "not", "no", "nor", "so", "if", "then",
    "at", "by", "for", "from", "in", "of", "on", "to", "with",
    "as", "up", "out", "off", "over", "into", "about",
    "的", "是", "了", "在", "有", "和", "就", "不", "人", "都",
    "一", "上", "也", "很", "到", "说", "要", "去", "你", "会",
    "着", "没有", "看", "好", "自己", "这", "他", "她",
    "none", "envelope", "send", "hiboss",
  ]);

  const texts = envelopes
    .map((e) => e.content.text ?? "")
    .join(" ");

  const words = texts
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !stopWords.has(w));

  // Deduplicate and limit
  const unique = [...new Set(words)];
  return unique.slice(0, MAX_KEYWORDS);
}

/**
 * Score a text block by keyword relevance.
 * Returns the count of distinct keywords found.
 */
function scoreBlock(block: string, keywords: string[]): number {
  const lower = block.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score++;
  }
  return score;
}

/**
 * Split a text into paragraph-level blocks for granular recall.
 */
function splitIntoBlocks(text: string, source: string): { text: string; source: string }[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({ text: block, source }));
}

/**
 * Read daily memory files within the search window.
 */
function readDailyMemoryFiles(params: {
  hibossDir: string;
  agentName: string;
  searchDays: number;
}): { text: string; source: string }[] {
  const dailyDir = path.join(
    getAgentInternalSpaceDir(params.hibossDir, params.agentName),
    "memories"
  );

  try {
    if (!fs.existsSync(dailyDir)) return [];
    const stat = fs.statSync(dailyDir);
    if (!stat.isDirectory()) return [];

    const files = fs
      .readdirSync(dailyDir)
      .filter((name) => DAILY_MEMORY_FILENAME_REGEX.test(name))
      .sort()
      .reverse()
      .slice(0, params.searchDays);

    const results: { text: string; source: string }[] = [];
    for (const filename of files) {
      const filePath = path.join(dailyDir, filename);
      try {
        const fileStat = fs.statSync(filePath);
        if (!fileStat.isFile()) continue;
        const content = fs.readFileSync(filePath, "utf8").trim();
        if (content) {
          results.push({ text: content, source: `memories/${filename}` });
        }
      } catch {
        // Skip unreadable files
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Read long-term MEMORY.md content.
 */
function readLongtermMemory(params: {
  hibossDir: string;
  agentName: string;
}): string {
  const memoryPath = path.join(
    getAgentInternalSpaceDir(params.hibossDir, params.agentName),
    "MEMORY.md"
  );

  try {
    if (!fs.existsSync(memoryPath)) return "";
    const stat = fs.statSync(memoryPath);
    if (!stat.isFile()) return "";
    return fs.readFileSync(memoryPath, "utf8").trim();
  } catch {
    return "";
  }
}

export interface RecallResult {
  /** Formatted memory fragments relevant to the current turn. Empty string if nothing relevant. */
  text: string;
  /** Number of keywords matched. */
  matchedKeywords: number;
  /** Total blocks searched. */
  blocksSearched: number;
}

/**
 * Recall memory fragments relevant to the current turn's envelopes.
 *
 * Strategy (v1 — keyword matching, zero external deps):
 * 1. Extract keywords from envelope texts
 * 2. Search MEMORY.md paragraphs and recent N days of daily memory
 * 3. Score each block by keyword matches
 * 4. Return top-scoring blocks within the recall budget
 */
export function recallRelevantMemory(params: {
  envelopes: Envelope[];
  hibossDir: string;
  agentName: string;
  maxChars?: number;
  searchDays?: number;
}): RecallResult {
  const maxChars = params.maxChars ?? DEFAULT_MEMORY_RECALL_MAX_CHARS;
  const searchDays = params.searchDays ?? DEFAULT_MEMORY_RECALL_SEARCH_DAYS;

  try {
    const keywords = extractKeywords(params.envelopes);
    if (keywords.length === 0) {
      return { text: "", matchedKeywords: 0, blocksSearched: 0 };
    }

    // Gather all searchable blocks
    const allBlocks: { text: string; source: string }[] = [];

    // Long-term memory blocks
    const longterm = readLongtermMemory({
      hibossDir: params.hibossDir,
      agentName: params.agentName,
    });
    if (longterm) {
      allBlocks.push(...splitIntoBlocks(longterm, "MEMORY.md"));
    }

    // Daily memory blocks (broader window than system prompt injection)
    const dailyFiles = readDailyMemoryFiles({
      hibossDir: params.hibossDir,
      agentName: params.agentName,
      searchDays,
    });
    for (const file of dailyFiles) {
      allBlocks.push(...splitIntoBlocks(file.text, file.source));
    }

    if (allBlocks.length === 0) {
      return { text: "", matchedKeywords: 0, blocksSearched: 0 };
    }

    // Score and rank blocks
    const scored = allBlocks
      .map((block) => ({ ...block, score: scoreBlock(block.text, keywords) }))
      .filter((b) => b.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { text: "", matchedKeywords: 0, blocksSearched: allBlocks.length };
    }

    // Assemble within budget
    const fragments: string[] = [];
    let totalChars = 0;
    let matchedKeywords = 0;
    const matchedKws = new Set<string>();

    for (const block of scored) {
      const entry = `[${block.source}] ${block.text}`;
      if (totalChars + entry.length > maxChars) {
        if (fragments.length > 0) break; // At least one fragment
        // First fragment exceeds budget; truncate it
        fragments.push(`${entry.slice(0, maxChars)}...`);
        totalChars = maxChars;
        break;
      }
      fragments.push(entry);
      totalChars += entry.length;

      // Track matched keywords
      const lower = block.text.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw)) matchedKws.add(kw);
      }
    }

    return {
      text: fragments.join("\n\n"),
      matchedKeywords: matchedKws.size,
      blocksSearched: allBlocks.length,
    };
  } catch (err) {
    logEvent("warn", "memory-recall-failed", {
      "agent-name": params.agentName,
      error: errorMessage(err),
    });
    return { text: "", matchedKeywords: 0, blocksSearched: 0 };
  }
}
