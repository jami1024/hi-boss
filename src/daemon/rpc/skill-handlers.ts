import * as path from "node:path";
import { getAgentDir } from "../../agent/home-setup.js";
import { isValidAgentName } from "../../shared/validation.js";
import {
  type RemoteSkillErrorCode,
  RemoteSkillError,
  type RemoteSkillTarget,
  getRemoteSkill,
  installRemoteSkill,
  listRemoteSkills,
  normalizeRemoteSkillName,
  removeRemoteSkill,
  updateRemoteSkill,
} from "../../skill/remote-skill-manager.js";
import {
  RPC_ERRORS,
  type RpcMethodRegistry,
  type SkillRemoteAddParams,
  type SkillRemoteAddResult,
  type SkillRemoteListParams,
  type SkillRemoteListResult,
  type SkillRemoteRefreshSummary,
  type SkillRemoteRemoveParams,
  type SkillRemoteRemoveResult,
  type SkillRemoteUpdateParams,
  type SkillRemoteUpdateResult,
} from "../ipc/types.js";
import type { DaemonContext } from "./context.js";
import { requireToken, rpcError } from "./context.js";

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,63}$/;

function normalizeProjectId(raw: unknown): string {
  if (typeof raw !== "string") {
    rpcError(
      RPC_ERRORS.INVALID_PARAMS,
      "Invalid project-id (expected lowercase letters/numbers with optional . _ : -)"
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized || !PROJECT_ID_PATTERN.test(normalized)) {
    rpcError(
      RPC_ERRORS.INVALID_PARAMS,
      "Invalid project-id (expected lowercase letters/numbers with optional . _ : -)"
    );
  }
  return normalized;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid string value");
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveTarget(ctx: DaemonContext, input: { agentName?: unknown; projectId?: unknown }): RemoteSkillTarget {
  const agentName = normalizeOptionalString(input.agentName);
  const projectIdRaw = input.projectId;
  const hasProject = projectIdRaw !== undefined && projectIdRaw !== null;

  if (agentName && hasProject) {
    rpcError(RPC_ERRORS.INVALID_PARAMS, "Specify either agentName or projectId, not both");
  }
  if (!agentName && !hasProject) {
    rpcError(RPC_ERRORS.INVALID_PARAMS, "Either agentName or projectId is required");
  }

  if (agentName) {
    if (!isValidAgentName(agentName)) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid agent name");
    }
    const agent = ctx.db.getAgentByNameCaseInsensitive(agentName);
    if (!agent) {
      rpcError(RPC_ERRORS.NOT_FOUND, "Agent not found");
    }
    return {
      type: "agent",
      id: agent.name,
      rootDir: path.join(getAgentDir(agent.name, ctx.config.dataDir), "skills"),
    };
  }

  const projectId = normalizeProjectId(projectIdRaw);
  const project = ctx.db.getProjectById(projectId);
  if (!project) {
    rpcError(RPC_ERRORS.NOT_FOUND, "Project not found");
  }
  return {
    type: "project",
    id: project.id,
    rootDir: path.join(project.root, ".hiboss", "skills"),
  };
}

function mapSkillError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const notFoundCodes = new Set<RemoteSkillErrorCode>([
    "source-path-not-found",
    "remote-skill-not-found",
  ]);

  if (err instanceof RemoteSkillError) {
    const data = {
      errorCode: err.errorCode,
      ...(err.hint ? { hint: err.hint } : {}),
    };
    if (notFoundCodes.has(err.errorCode)) {
      rpcError(RPC_ERRORS.NOT_FOUND, err.message, data);
    }
    rpcError(RPC_ERRORS.INVALID_PARAMS, err.message, data);
  }

  if (/not found/i.test(message)) {
    rpcError(RPC_ERRORS.NOT_FOUND, message, { errorCode: "remote-skill-not-found" });
  }
  rpcError(RPC_ERRORS.INVALID_PARAMS, message, { errorCode: "install-failed" });
}

function requestRefreshForRemoteSkillChange(
  ctx: DaemonContext,
  target: RemoteSkillTarget,
  reason: string
): SkillRemoteRefreshSummary {
  const requested: SkillRemoteRefreshSummary["requested"] = [];

  if (target.type === "agent") {
    ctx.executor.requestSessionRefresh(target.id, reason, "agent");
    requested.push({ agentName: target.id, scope: "agent" });
    return {
      count: requested.length,
      requested,
    };
  }

  const project = ctx.db.getProjectById(target.id);
  if (!project) {
    return {
      count: 0,
      requested,
    };
  }

  const members = new Set<string>([
    project.speakerAgent,
    ...ctx.db.listProjectLeaders(project.id, { activeOnly: false }).map((leader) => leader.agentName),
  ]);

  for (const agentName of members) {
    ctx.executor.requestSessionRefresh(agentName, reason, "project", project.id);
    requested.push({
      agentName,
      scope: "project",
      projectId: project.id,
    });
  }

  return {
    count: requested.length,
    requested,
  };
}

export function createSkillHandlers(ctx: DaemonContext): RpcMethodRegistry {
  return {
    "skill.remote.add": async (params) => {
      const p = params as unknown as SkillRemoteAddParams;
      const token = requireToken(p.token);
      const principal = ctx.resolvePrincipal(token);
      ctx.assertOperationAllowed("skill.remote.add", principal);

      const target = resolveTarget(ctx, { agentName: p.agentName, projectId: p.projectId });
      const sourceUrl = normalizeOptionalString(p.sourceUrl);
      if (!sourceUrl) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "sourceUrl is required");
      }

      try {
        const skill = installRemoteSkill({
          target,
          skillName: p.skillName,
          sourceUrl,
          ref: normalizeOptionalString(p.ref),
        });
        const result: SkillRemoteAddResult = {
          targetType: target.type,
          targetId: target.id,
          skill,
          refresh: requestRefreshForRemoteSkillChange(ctx, target, "rpc:skill.remote.add"),
        };
        return result;
      } catch (err) {
        mapSkillError(err);
      }
    },

    "skill.remote.list": async (params) => {
      const p = params as unknown as SkillRemoteListParams;
      const token = requireToken(p.token);
      const principal = ctx.resolvePrincipal(token);
      ctx.assertOperationAllowed("skill.remote.list", principal);

      const target = resolveTarget(ctx, { agentName: p.agentName, projectId: p.projectId });
      const result: SkillRemoteListResult = {
        targetType: target.type,
        targetId: target.id,
        skills: listRemoteSkills(target),
      };
      return result;
    },

    "skill.remote.update": async (params) => {
      const p = params as unknown as SkillRemoteUpdateParams;
      const token = requireToken(p.token);
      const principal = ctx.resolvePrincipal(token);
      ctx.assertOperationAllowed("skill.remote.update", principal);

      const target = resolveTarget(ctx, { agentName: p.agentName, projectId: p.projectId });
      try {
        const skill = updateRemoteSkill({
          target,
          skillName: p.skillName,
          sourceUrl: normalizeOptionalString(p.sourceUrl),
          ref: normalizeOptionalString(p.ref),
        });
        const result: SkillRemoteUpdateResult = {
          targetType: target.type,
          targetId: target.id,
          skill,
          refresh: requestRefreshForRemoteSkillChange(ctx, target, "rpc:skill.remote.update"),
        };
        return result;
      } catch (err) {
        mapSkillError(err);
      }
    },

    "skill.remote.remove": async (params) => {
      const p = params as unknown as SkillRemoteRemoveParams;
      const token = requireToken(p.token);
      const principal = ctx.resolvePrincipal(token);
      ctx.assertOperationAllowed("skill.remote.remove", principal);

      const target = resolveTarget(ctx, { agentName: p.agentName, projectId: p.projectId });
      try {
        const skillName = normalizeRemoteSkillName(p.skillName);
        const existing = getRemoteSkill(target, skillName);
        if (!existing) {
          rpcError(RPC_ERRORS.NOT_FOUND, `Remote skill '${skillName}' not found`);
        }
        removeRemoteSkill(target, skillName);
        const result: SkillRemoteRemoveResult = {
          success: true,
          targetType: target.type,
          targetId: target.id,
          skillName,
          refresh: requestRefreshForRemoteSkillChange(ctx, target, "rpc:skill.remote.remove"),
        };
        return result;
      } catch (err) {
        mapSkillError(err);
      }
    },
  };
}
