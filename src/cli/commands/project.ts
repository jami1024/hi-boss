import { getDefaultConfig, getSocketPath } from "../../daemon/daemon.js";
import { IpcClient } from "../ipc-client.js";
import { resolveToken } from "../token.js";
import type {
  ProjectGetResult,
  ProjectListResult,
  ProjectSelectLeaderResult,
} from "../../daemon/ipc/types.js";
import type { Project } from "../../shared/project.js";
import { formatUnixMsAsTimeZoneOffset } from "../../shared/time.js";
import { getDaemonTimeContext } from "../time-context.js";

export interface ProjectListOptions {
  token?: string;
  limit?: number;
}

export interface ProjectGetOptions {
  token?: string;
  id: string;
}

export interface ProjectSelectLeaderOptions {
  token?: string;
  projectId: string;
  requiredCapabilities?: string[];
}

function formatProject(project: Project, bossTimezone: string): string {
  const lines: string[] = [];
  lines.push(`project-id: ${project.id}`);
  lines.push(`project-name: ${project.name}`);
  lines.push(`project-root: ${project.root}`);
  lines.push(`project-speaker-agent: ${project.speakerAgent}`);
  lines.push(`project-main-group-channel: ${project.mainGroupChannel ?? "(none)"}`);
  lines.push(
    `project-leaders: ${
      project.leaders && project.leaders.length > 0
        ? project.leaders.map((leader) => leader.agentName).join(", ")
        : "(none)"
    }`
  );
  lines.push(`created-at: ${formatUnixMsAsTimeZoneOffset(project.createdAt, bossTimezone)}`);
  lines.push(
    `updated-at: ${
      typeof project.updatedAt === "number"
        ? formatUnixMsAsTimeZoneOffset(project.updatedAt, bossTimezone)
        : "(none)"
    }`
  );
  return lines.join("\n");
}

export async function listProjects(options: ProjectListOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));

  try {
    const token = resolveToken(options.token);
    const time = await getDaemonTimeContext({ client, token });
    const result = await client.call<ProjectListResult>("project.list", {
      token,
      limit: options.limit,
    });

    if (result.projects.length === 0) {
      console.log("no-projects: true");
      return;
    }

    for (const project of result.projects) {
      console.log(formatProject(project, time.bossTimezone));
      console.log();
    }
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function getProject(options: ProjectGetOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));

  try {
    const token = resolveToken(options.token);
    const time = await getDaemonTimeContext({ client, token });
    const result = await client.call<ProjectGetResult>("project.get", {
      token,
      id: options.id,
    });

    console.log(formatProject(result.project, time.bossTimezone));
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function selectProjectLeader(options: ProjectSelectLeaderOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));

  try {
    const token = resolveToken(options.token);
    const requiredCapabilities =
      (options.requiredCapabilities ?? [])
        .map((capability) => capability.trim())
        .filter((capability) => capability.length > 0) ?? [];

    const result = await client.call<ProjectSelectLeaderResult>("project.select-leader", {
      token,
      projectId: options.projectId,
      requiredCapabilities,
    });

    console.log(`project-id: ${result.projectId}`);
    console.log(
      `required-capabilities: ${
        result.requiredCapabilities.length > 0 ? result.requiredCapabilities.join(", ") : "(none)"
      }`
    );
    console.log(`candidate-count: ${result.candidates.length}`);

    if (result.selected) {
      console.log(`selected-agent: ${result.selected.agentName}`);
      console.log(`selected-agent-health: ${result.selected.agentHealth}`);
      console.log(`selected-agent-busy: ${result.selected.busy ? "true" : "false"}`);
      console.log(
        `selected-capabilities: ${
          result.selected.capabilities.length > 0
            ? result.selected.capabilities.join(", ")
            : "(none)"
        }`
      );
    } else {
      console.log("selected-agent: (none)");
      console.log("selected-agent-health: (none)");
      console.log("selected-agent-busy: (none)");
      console.log("selected-capabilities: (none)");
    }

    for (let i = 0; i < result.candidates.length; i++) {
      const candidate = result.candidates[i];
      console.log(
        `candidate-${i + 1}: agent=${candidate.agentName}; health=${candidate.agentHealth}; busy=${
          candidate.busy ? "true" : "false"
        }; capabilities=${candidate.capabilities.length > 0 ? candidate.capabilities.join(",") : "(none)"}`
      );
    }
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}
