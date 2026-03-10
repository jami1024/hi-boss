import type {
  ProjectGetParams,
  ProjectGetResult,
  ProjectListParams,
  ProjectListResult,
  ProjectSelectLeaderParams,
  ProjectSelectLeaderResult,
  RpcMethodRegistry,
} from "../ipc/types.js";
import { RPC_ERRORS } from "../ipc/types.js";
import type { DaemonContext } from "./context.js";
import { requireToken, rpcError } from "./context.js";

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,63}$/;

function normalizeProjectId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!PROJECT_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

function parseCapabilityValues(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.toLowerCase())
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

function healthRank(health: "ok" | "unknown" | "error"): number {
  if (health === "ok") return 0;
  if (health === "unknown") return 1;
  return 2;
}

export function createProjectHandlers(ctx: DaemonContext): RpcMethodRegistry {
  const createProjectList = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as ProjectListParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    if (principal.kind !== "agent") {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Access denied");
    }
    ctx.db.updateAgentLastSeen(principal.agent.name);

    const limit = (() => {
      if (p.limit === undefined || p.limit === null) return 50;
      if (typeof p.limit !== "number" || !Number.isFinite(p.limit)) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid limit");
      }
      const n = Math.trunc(p.limit);
      if (n <= 0) rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid limit (must be >= 1)");
      if (n > 200) rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid limit (max 200)");
      return n;
    })();

    const result: ProjectListResult = {
      projects: ctx.db.listProjects({ limit }),
    };
    return result;
  };

  const createProjectGet = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as ProjectGetParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    if (principal.kind !== "agent") {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Access denied");
    }
    ctx.db.updateAgentLastSeen(principal.agent.name);

    if (typeof p.id !== "string") {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid id");
    }
    const id = normalizeProjectId(p.id);
    if (!id) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        "Invalid id (expected lowercase letters/numbers with optional . _ : -)"
      );
    }

    const project = ctx.db.getProjectById(id);
    if (!project) {
      rpcError(RPC_ERRORS.NOT_FOUND, "Project not found");
    }

    const result: ProjectGetResult = { project };
    return result;
  };

  const createProjectSelectLeader = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as ProjectSelectLeaderParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    if (principal.kind !== "agent") {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Access denied");
    }
    ctx.db.updateAgentLastSeen(principal.agent.name);

    if (typeof p.projectId !== "string") {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid project-id");
    }
    const projectId = normalizeProjectId(p.projectId);
    if (!projectId) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        "Invalid project-id (expected lowercase letters/numbers with optional . _ : -)"
      );
    }

    const project = ctx.db.getProjectById(projectId);
    if (!project) {
      rpcError(RPC_ERRORS.NOT_FOUND, "Project not found");
    }

    const requiredCapabilities = parseCapabilityValues(p.requiredCapabilities);
    const candidates = ctx.db
      .listProjectLeaders(project.id, { activeOnly: true })
      .map((leader) => {
        const agent = ctx.db.getAgentByNameCaseInsensitive(leader.agentName);
        if (!agent) return null;

        const lastRun = ctx.db.getLastFinishedAgentRun(agent.name);
        const agentHealth: "ok" | "unknown" | "error" =
          !lastRun ? "unknown" : lastRun.status === "failed" ? "error" : "ok";

        return {
          agentName: agent.name,
          capabilities: leader.capabilities,
          active: leader.active,
          busy: ctx.executor.isAgentBusy(agent.name),
          agentHealth,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) =>
        requiredCapabilities.every((required) => row.capabilities.includes(required))
      )
      .sort((a, b) => {
        const healthDelta = healthRank(a.agentHealth) - healthRank(b.agentHealth);
        if (healthDelta !== 0) return healthDelta;
        if (a.busy !== b.busy) return a.busy ? 1 : -1;
        return a.agentName.localeCompare(b.agentName);
      });

    const result: ProjectSelectLeaderResult = {
      projectId: project.id,
      requiredCapabilities,
      selected: candidates[0],
      candidates,
    };
    return result;
  };

  return {
    "project.list": createProjectList("project.list"),
    "project.get": createProjectGet("project.get"),
    "project.select-leader": createProjectSelectLeader("project.select-leader"),
  };
}
