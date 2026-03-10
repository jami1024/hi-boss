import type {
  SkillRemoteAddResult,
  SkillRemoteListResult,
  SkillRemoteRemoveResult,
  SkillRemoteUpdateResult,
} from "../../daemon/ipc/types.js";
import { getDefaultConfig, getSocketPath } from "../../daemon/daemon.js";
import { IpcClient } from "../ipc-client.js";
import { resolveToken } from "../token.js";

export interface SkillTargetOptions {
  token?: string;
  agentName?: string;
  projectId?: string;
}

export interface SkillAddRemoteOptions extends SkillTargetOptions {
  skillName: string;
  sourceUrl: string;
  ref?: string;
}

export interface SkillUpdateRemoteOptions extends SkillTargetOptions {
  skillName: string;
  sourceUrl?: string;
  ref?: string;
}

export interface SkillRemoveRemoteOptions extends SkillTargetOptions {
  skillName: string;
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildTargetPayload(options: SkillTargetOptions): { agentName?: string; projectId?: string } {
  const agentName = normalizeOptional(options.agentName);
  const projectId = normalizeOptional(options.projectId)?.toLowerCase();
  if ((agentName && projectId) || (!agentName && !projectId)) {
    throw new Error("Specify exactly one of --agent or --project-id");
  }
  return {
    ...(agentName ? { agentName } : {}),
    ...(projectId ? { projectId } : {}),
  };
}

function printSkillResult(prefix: string, result: {
  targetType: "agent" | "project";
  targetId: string;
  skill: {
    skillName: string;
    sourceUrl: string;
    sourceRef: string;
    sourcePath: string;
    repositoryUrl: string;
    commit: string;
    checksum: string;
    fileCount: number;
    status: string;
    addedAt: string;
    lastUpdated: string;
  };
  refresh: {
    count: number;
    requested: Array<{ agentName: string; scope: "agent" | "project"; projectId?: string }>;
  };
}): void {
  console.log(`${prefix}: true`);
  console.log(`target-type: ${result.targetType}`);
  console.log(`target-id: ${result.targetId}`);
  console.log(`skill-name: ${result.skill.skillName}`);
  console.log(`source-url: ${result.skill.sourceUrl}`);
  console.log(`source-ref: ${result.skill.sourceRef}`);
  console.log(`source-path: ${result.skill.sourcePath || "."}`);
  console.log(`repository-url: ${result.skill.repositoryUrl}`);
  console.log(`commit: ${result.skill.commit}`);
  console.log(`checksum: ${result.skill.checksum}`);
  console.log(`file-count: ${result.skill.fileCount}`);
  console.log(`status: ${result.skill.status}`);
  console.log(`added-at: ${result.skill.addedAt}`);
  console.log(`last-updated: ${result.skill.lastUpdated}`);
  console.log(`refresh-count: ${result.refresh.count}`);
  console.log(
    `refresh-targets: ${
      result.refresh.requested.length > 0
        ? result.refresh.requested
            .map((entry) =>
              entry.scope === "project" && entry.projectId
                ? `${entry.agentName}:${entry.projectId}`
                : entry.agentName
            )
            .join(", ")
        : "(none)"
    }`
  );
}

export async function addRemoteSkill(options: SkillAddRemoteOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));
  try {
    const token = resolveToken(options.token);
    const target = buildTargetPayload(options);
    const result = await client.call<SkillRemoteAddResult>("skill.remote.add", {
      token,
      skillName: options.skillName,
      sourceUrl: options.sourceUrl,
      ref: normalizeOptional(options.ref),
      ...target,
    });
    printSkillResult("added", result);
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function listRemoteSkill(options: SkillTargetOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));
  try {
    const token = resolveToken(options.token);
    const target = buildTargetPayload(options);
    const result = await client.call<SkillRemoteListResult>("skill.remote.list", {
      token,
      ...target,
    });

    console.log(`target-type: ${result.targetType}`);
    console.log(`target-id: ${result.targetId}`);
    console.log(`remote-skill-count: ${result.skills.length}`);
    if (result.skills.length === 0) {
      console.log("no-remote-skills: true");
      return;
    }

    for (const skill of result.skills) {
      console.log();
      console.log(`skill-name: ${skill.skillName}`);
      console.log(`source-url: ${skill.sourceUrl}`);
      console.log(`source-ref: ${skill.sourceRef}`);
      console.log(`source-path: ${skill.sourcePath || "."}`);
      console.log(`repository-url: ${skill.repositoryUrl}`);
      console.log(`commit: ${skill.commit}`);
      console.log(`checksum: ${skill.checksum}`);
      console.log(`file-count: ${skill.fileCount}`);
      console.log(`status: ${skill.status}`);
      console.log(`added-at: ${skill.addedAt}`);
      console.log(`last-updated: ${skill.lastUpdated}`);
    }
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function updateRemoteSkillCommand(options: SkillUpdateRemoteOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));
  try {
    const token = resolveToken(options.token);
    const target = buildTargetPayload(options);
    const result = await client.call<SkillRemoteUpdateResult>("skill.remote.update", {
      token,
      skillName: options.skillName,
      sourceUrl: normalizeOptional(options.sourceUrl),
      ref: normalizeOptional(options.ref),
      ...target,
    });
    printSkillResult("updated", result);
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function removeRemoteSkillCommand(options: SkillRemoveRemoteOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));
  try {
    const token = resolveToken(options.token);
    const target = buildTargetPayload(options);
    const result = await client.call<SkillRemoteRemoveResult>("skill.remote.remove", {
      token,
      skillName: options.skillName,
      ...target,
    });
    console.log(`removed: ${result.success ? "true" : "false"}`);
    console.log(`target-type: ${result.targetType}`);
    console.log(`target-id: ${result.targetId}`);
    console.log(`skill-name: ${result.skillName}`);
    console.log(`refresh-count: ${result.refresh.count}`);
    console.log(
      `refresh-targets: ${
        result.refresh.requested.length > 0
          ? result.refresh.requested
              .map((entry) =>
                entry.scope === "project" && entry.projectId
                  ? `${entry.agentName}:${entry.projectId}`
                  : entry.agentName
              )
              .join(", ")
          : "(none)"
      }`
    );
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}
