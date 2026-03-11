import * as fs from "node:fs";
import * as path from "node:path";
import type { HiBossDatabase } from "../daemon/db/database.js";
import type { Envelope } from "../envelope/types.js";
import type { Project } from "../shared/project.js";
import { readAgentSkillSummary } from "./instruction-generator.js";
import { getHiBossDir } from "./home-setup.js";

const MAX_PROJECT_INSTRUCTION_CHARS = 12_000;
const MAX_PROJECT_SCRIPT_LINES = 30;
const MAX_PROJECT_SKILL_LINES = 30;
const MAX_PROJECT_MEMORY_LINES = 20;
const MAX_PROJECT_MEMORY_CHARS = 6_000;

function readEnvelopeProjectId(envelope: Envelope): string | undefined {
  const metadata = envelope.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const projectId = (metadata as Record<string, unknown>).projectId;
  if (typeof projectId !== "string") return undefined;
  const normalized = projectId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readEnvelopeTaskId(envelope: Envelope): string | undefined {
  const metadata = envelope.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const taskId = (metadata as Record<string, unknown>).taskId;
  if (typeof taskId !== "string") return undefined;
  const normalized = taskId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[...truncated...]`;
}

function readProjectInstructionFile(projectRoot: string): string | undefined {
  const filePath = path.join(projectRoot, "HIBOSS.md");
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return undefined;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return undefined;
    return truncateText(content, MAX_PROJECT_INSTRUCTION_CHARS);
  } catch {
    return undefined;
  }
}

function readProjectScriptSummary(projectRoot: string): string[] {
  const packageJsonPath = path.join(projectRoot, "package.json");
  try {
    if (!fs.existsSync(packageJsonPath)) return [];
    const stat = fs.statSync(packageJsonPath);
    if (!stat.isFile()) return [];
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scripts = parsed.scripts;
    if (!scripts || typeof scripts !== "object") return [];
    const entries = Object.entries(scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, MAX_PROJECT_SCRIPT_LINES)
      .map(([name, cmd]) => `- ${name}: ${cmd}`);
    return entries;
  } catch {
    return [];
  }
}

function readProjectSkillSummary(projectRoot: string): string[] {
  const skillsRoot = path.join(projectRoot, ".hiboss", "skills");
  try {
    if (!fs.existsSync(skillsRoot)) return [];
    const stat = fs.statSync(skillsRoot);
    if (!stat.isDirectory()) return [];

    const entries = fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_PROJECT_SKILL_LINES)
      .map((skillName) => {
        const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
        if (!fs.existsSync(skillPath)) return `- ${skillName}: (missing SKILL.md)`;
        const skillStat = fs.statSync(skillPath);
        if (!skillStat.isFile()) return `- ${skillName}: (invalid SKILL.md)`;
        const content = fs.readFileSync(skillPath, "utf-8");
        const firstLine = content
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0 && !line.startsWith("#"));
        const summary = firstLine ? truncateText(firstLine, 140) : "(no summary)";
        return `- ${skillName}: ${summary}`;
      });

    return entries;
  } catch {
    return [];
  }
}

function readProjectMemorySummary(projectRoot: string): string[] {
  const memoryRoot = path.join(projectRoot, ".hiboss", "memory");
  try {
    if (!fs.existsSync(memoryRoot)) return [];
    const stat = fs.statSync(memoryRoot);
    if (!stat.isDirectory()) return [];

    const files = fs
      .readdirSync(memoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_PROJECT_MEMORY_LINES)
      .map((fileName) => {
        const filePath = path.join(memoryRoot, fileName);
        const content = fs.readFileSync(filePath, "utf-8").trim();
        const snippet = truncateText(content.replace(/\s+/g, " "), MAX_PROJECT_MEMORY_CHARS)
          .split("\n")[0]
          ?.trim();
        return `- ${fileName}: ${snippet || "(empty)"}`;
      });

    return files;
  } catch {
    return [];
  }
}

function buildProjectAdditionalContext(params: {
  project: Project;
  activeLeaders: string[];
  teamCapabilities: { agentName: string; description?: string; skills: string[] }[];
  instructionFile?: string;
  scriptSummary: string[];
  skillSummary: string[];
  memorySummary: string[];
  taskId?: string;
}): string {
  const sections: string[] = [
    "## project-context",
    `project-id: ${params.project.id}`,
    `project-name: ${params.project.name}`,
    `project-root: ${params.project.root}`,
    `allowed-leaders: ${params.activeLeaders.join(", ") || "(none)"}`,
    "workspace-restriction: operate only inside project-root",
    "",
    "rules:",
    "- In project context, dispatch only to speaker/allowed leaders in this project.",
    "- Keep all file operations within project-root.",
    "- Do not change directory outside project-root.",
  ];

  if (params.teamCapabilities.length > 0) {
    sections.push(
      "",
      "## team-capabilities",
      "Available leader agents and their installed skills:",
    );
    for (const tc of params.teamCapabilities) {
      sections.push(`### ${tc.agentName}`);
      if (tc.description) {
        sections.push(`description: ${tc.description}`);
      }
      if (tc.skills.length > 0) {
        sections.push("skills:", ...tc.skills);
      } else {
        sections.push("skills: (none)");
      }
    }
  }

  if (params.taskId) {
    sections.push(
      "",
      "## task-context",
      `task-id: ${params.taskId}`,
      "progress-reporting:",
      "- Send progress updates with a line starting `progress:`.",
      "- Optional todos line format: `todos: step1 done; step2 doing`.",
      "- taskId is auto-propagated by daemon in this run context.",
    );
  }

  if (params.instructionFile) {
    sections.push(
      "",
      "## project-instructions (HIBOSS.md)",
      params.instructionFile,
    );
  }

  if (params.scriptSummary.length > 0) {
    sections.push(
      "",
      "## project-skills (package.json scripts)",
      ...params.scriptSummary,
    );
  }

  if (params.skillSummary.length > 0) {
    sections.push(
      "",
      "## project-skills (local SKILL.md)",
      ...params.skillSummary,
    );
  }

  if (params.memorySummary.length > 0) {
    sections.push(
      "",
      "## project-memory-snapshot (.hiboss/memory)",
      ...params.memorySummary,
    );
  }

  return sections.join("\n");
}

function readEnvelopeConversationId(envelope: Envelope): string | undefined {
  const metadata = envelope.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const conversationId = (metadata as Record<string, unknown>).conversationId;
  if (typeof conversationId !== "string") return undefined;
  const normalized = conversationId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export interface AgentRunProjectScope {
  sessionKey: string;
  isProjectScoped: boolean;
  conversationId?: string;
  project?: Project;
  projectId?: string;
  taskId?: string;
  workspaceOverride?: string;
  additionalContext?: string;
}

export function resolveAgentRunProjectScope(params: {
  db: HiBossDatabase;
  agentName: string;
  envelopes: Envelope[];
}): AgentRunProjectScope {
  let projectId: string | undefined;
  let taskId: string | undefined;
  let conversationId: string | undefined;
  for (const envelope of params.envelopes) {
    const envelopeProjectId = readEnvelopeProjectId(envelope);
    if (!envelopeProjectId) continue;
    if (!projectId) {
      projectId = envelopeProjectId;
      continue;
    }
    if (projectId !== envelopeProjectId) {
      throw new Error("Conflicting project context in a single agent run");
    }
  }

  for (const envelope of params.envelopes) {
    const envelopeTaskId = readEnvelopeTaskId(envelope);
    if (!envelopeTaskId) continue;
    if (!taskId) {
      taskId = envelopeTaskId;
      continue;
    }
    if (taskId !== envelopeTaskId) {
      throw new Error("Conflicting task context in a single agent run");
    }
  }

  // Extract conversationId from envelopes (first non-empty wins).
  for (const envelope of params.envelopes) {
    const id = readEnvelopeConversationId(envelope);
    if (id) {
      conversationId = id;
      break;
    }
  }

  if (!projectId) {
    // Conversation-scoped session key takes priority over bare agent name.
    const sessionKey = conversationId
      ? `${params.agentName}:conv:${conversationId}`
      : params.agentName;
    return {
      sessionKey,
      isProjectScoped: false,
      ...(conversationId ? { conversationId } : {}),
      ...(taskId ? { taskId } : {}),
    };
  }

  const project = params.db.getProjectById(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found for project-scoped run`);
  }

  const activeLeaders = params.db
    .listProjectLeaders(project.id, { activeOnly: true })
    .map((leader) => leader.agentName);
  const hibossDir = getHiBossDir();
  const teamCapabilities = activeLeaders.map((leaderName) => {
    const leaderAgent = params.db.getAgentByNameCaseInsensitive(leaderName);
    return {
      agentName: leaderName,
      description: leaderAgent?.description ?? undefined,
      skills: readAgentSkillSummary({ hibossDir, agentName: leaderName }),
    };
  });
  const instructionFile = readProjectInstructionFile(project.root);
  const scriptSummary = readProjectScriptSummary(project.root);
  const skillSummary = readProjectSkillSummary(project.root);
  const memorySummary = readProjectMemorySummary(project.root);

  // Conversation-scoped session key takes priority over bare project key.
  const projectSessionKey = conversationId
    ? `${params.agentName}:conv:${conversationId}`
    : `${params.agentName}:${project.id}`;

  return {
    sessionKey: projectSessionKey,
    isProjectScoped: true,
    ...(conversationId ? { conversationId } : {}),
    project,
    projectId: project.id,
    ...(taskId ? { taskId } : {}),
    workspaceOverride: project.root,
    additionalContext: buildProjectAdditionalContext({
      project,
      activeLeaders,
      teamCapabilities,
      instructionFile,
      scriptSummary,
      skillSummary,
      memorySummary,
      ...(taskId ? { taskId } : {}),
    }),
  };
}
