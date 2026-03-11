/**
 * Instruction generator for agent system prompts.
 *
 * Generates system instructions as a string to be passed inline
 * to provider CLIs via --append-system-prompt (Claude) or
 * -c developer_instructions=... (Codex).
 */

import type { Agent } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentBinding } from "../daemon/db/database.js";
import { renderPrompt } from "../shared/prompt-renderer.js";
import { buildSystemPromptContext } from "../shared/prompt-context.js";
import { getAgentDir } from "./home-setup.js";
import {
  ensureAgentInternalSpaceLayout,
  readAgentInternalDailyMemorySnapshot,
  readAgentInternalMemorySnapshot,
} from "../shared/internal-space.js";

const MAX_AGENT_SKILL_LINES = 30;

function truncateSkillSummary(text: string, maxChars = 140): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function extractSkillSummary(content: string): string {
  const lines = content.split("\n").map((line) => line.trim());
  let inFrontmatter = false;
  for (const line of lines) {
    if (!line) continue;
    if (!inFrontmatter && line === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line === "---") {
      inFrontmatter = false;
      continue;
    }
    if (inFrontmatter) continue;
    if (line.startsWith("#")) continue;
    return truncateSkillSummary(line);
  }
  return "(no summary)";
}

export function readAgentSkillSummary(params: { hibossDir: string; agentName: string }): string[] {
  const skillsRoot = path.join(getAgentDir(params.agentName, params.hibossDir), "skills");
  try {
    if (!fs.existsSync(skillsRoot)) return [];
    const stat = fs.statSync(skillsRoot);
    if (!stat.isDirectory()) return [];

    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_AGENT_SKILL_LINES)
      .map((skillName) => {
        const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
        if (!fs.existsSync(skillPath)) return `- ${skillName}: (missing SKILL.md)`;
        const skillStat = fs.statSync(skillPath);
        if (!skillStat.isFile()) return `- ${skillName}: (invalid SKILL.md)`;
        const content = fs.readFileSync(skillPath, "utf8");
        return `- ${skillName}: ${extractSkillSummary(content)}`;
      });
  } catch {
    return [];
  }
}

/**
 * Context for generating system instructions.
 */
export interface InstructionContext {
  agent: Agent;
  agentToken: string;
  bindings?: AgentBinding[];
  additionalContext?: string;
  runtimeWorkspace?: string;
  hibossDir?: string;
  bossTimezone?: string;
  boss?: {
    name?: string;
    adapterIds?: Record<string, string>;
  };
}

function chooseFence(text: string): string {
  let fence = "```";
  while (text.includes(fence)) {
    fence += "`";
  }
  return fence;
}

/**
 * Generate system instructions for an agent.
 *
 * Returns a string suitable for passing inline to CLI flags:
 * - Claude: --append-system-prompt
 * - Codex: -c developer_instructions=...
 *
 * @param ctx - Instruction context with agent info and bindings
 * @returns Generated instruction content
 */
export function generateSystemInstructions(ctx: InstructionContext): string {
  const { agent, agentToken, bindings, additionalContext, boss } = ctx;

  const promptContext = buildSystemPromptContext({
    agent,
    agentToken,
    bindings: bindings ?? [],
    runtimeWorkspace: ctx.runtimeWorkspace,
    time: { bossTimezone: ctx.bossTimezone },
    hibossDir: ctx.hibossDir,
    boss,
  });

  // Inject internal space MEMORY.md snapshot for this agent (best-effort; never prints token).
  const hibossDir = ctx.hibossDir ?? (promptContext.hiboss as Record<string, unknown>).dir as string;
  const spaceContext = promptContext.internalSpace as Record<string, unknown>;
  const ensured = ensureAgentInternalSpaceLayout({ hibossDir, agentName: agent.name });
  if (!ensured.ok) {
    spaceContext.note = "";
    spaceContext.noteFence = "```";
    spaceContext.error = ensured.error;
    spaceContext.daily = "";
    spaceContext.dailyFence = "```";
    spaceContext.dailyError = ensured.error;
  } else {
    const snapshot = readAgentInternalMemorySnapshot({ hibossDir, agentName: agent.name });
    if (snapshot.ok) {
      spaceContext.note = snapshot.note;
      spaceContext.noteFence = chooseFence(snapshot.note);
      spaceContext.error = "";
    } else {
      spaceContext.note = "";
      spaceContext.noteFence = "```";
      spaceContext.error = snapshot.error;
    }

    const dailySnapshot = readAgentInternalDailyMemorySnapshot({ hibossDir, agentName: agent.name });
    if (dailySnapshot.ok) {
      spaceContext.daily = dailySnapshot.note;
      spaceContext.dailyFence = chooseFence(dailySnapshot.note);
      spaceContext.dailyError = "";
    } else {
      spaceContext.daily = "";
      spaceContext.dailyFence = "```";
      spaceContext.dailyError = dailySnapshot.error;
    }
  }

  const agentSkillSummary = readAgentSkillSummary({ hibossDir, agentName: agent.name });
  const additionalContextSections: string[] = [];
  if (agentSkillSummary.length > 0) {
    additionalContextSections.push("## agent-remote-skills", ...agentSkillSummary);
  }
  if (additionalContext?.trim()) {
    if (additionalContextSections.length > 0) {
      additionalContextSections.push("");
    }
    additionalContextSections.push(additionalContext.trim());
  }

  (promptContext.hiboss as Record<string, unknown>).additionalContext =
    additionalContextSections.join("\n");

  return renderPrompt({
    surface: "system",
    template: "system/base.md",
    context: promptContext,
  });
}
