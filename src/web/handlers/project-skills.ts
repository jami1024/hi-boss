import type { DaemonContext } from "../../daemon/rpc/context.js";
import { requireBossToken } from "../middleware/auth.js";
import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";

function rpcErrorToHttpStatus(code?: number): number {
  return code === -32001 ? 401 : code === -32002 ? 404 : code === -32003 ? 409 : code === -32602 ? 400 : 500;
}

function rpcErrorPayload(error: Error & { data?: unknown }) {
  const data =
    error.data && typeof error.data === "object"
      ? (error.data as Record<string, unknown>)
      : undefined;
  const errorCode = typeof data?.errorCode === "string" ? data.errorCode : undefined;
  const hint = typeof data?.hint === "string" ? data.hint : undefined;
  return {
    error: error.message,
    ...(errorCode ? { errorCode } : {}),
    ...(hint ? { hint } : {}),
  };
}

function getSkillRpcHandler(
  daemon: DaemonContext,
  method: "skill.remote.list" | "skill.remote.add" | "skill.remote.update" | "skill.remote.remove"
): ((params: Record<string, unknown>) => Promise<unknown>) | null {
  const handler = daemon.rpcHandlers[method];
  if (!handler) {
    return null;
  }
  return handler as (params: Record<string, unknown>) => Promise<unknown>;
}

export function createProjectSkillHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  const listRemoteSkills: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const projectId = ctx.params.id;
    if (!projectId) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    const handler = getSkillRpcHandler(daemon, "skill.remote.list");
    if (!handler) {
      sendJson(ctx.res, 500, { error: "skill.remote.list handler is not available" });
      return;
    }

    try {
      const result = await handler({ token, projectId });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const addRemoteSkill: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const projectId = ctx.params.id;
    if (!projectId) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const skillName = typeof body.skillName === "string" ? body.skillName : undefined;
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;
    const ref = typeof body.ref === "string" ? body.ref : undefined;

    const handler = getSkillRpcHandler(daemon, "skill.remote.add");
    if (!handler) {
      sendJson(ctx.res, 500, { error: "skill.remote.add handler is not available" });
      return;
    }

    try {
      const result = await handler({ token, projectId, skillName, sourceUrl, ref });
      sendJson(ctx.res, 201, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const updateRemoteSkill: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const projectId = ctx.params.id;
    const skillName = ctx.params.skillName;
    if (!projectId || !skillName) {
      sendJson(ctx.res, 400, { error: "Project ID and skill name required" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    const sourceUrl = body && typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;
    const ref = body && typeof body.ref === "string" ? body.ref : undefined;

    const handler = getSkillRpcHandler(daemon, "skill.remote.update");
    if (!handler) {
      sendJson(ctx.res, 500, { error: "skill.remote.update handler is not available" });
      return;
    }

    try {
      const result = await handler({ token, projectId, skillName, sourceUrl, ref });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const removeRemoteSkill: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const projectId = ctx.params.id;
    const skillName = ctx.params.skillName;
    if (!projectId || !skillName) {
      sendJson(ctx.res, 400, { error: "Project ID and skill name required" });
      return;
    }

    const handler = getSkillRpcHandler(daemon, "skill.remote.remove");
    if (!handler) {
      sendJson(ctx.res, 500, { error: "skill.remote.remove handler is not available" });
      return;
    }

    try {
      const result = await handler({ token, projectId, skillName });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  return {
    listRemoteSkills,
    addRemoteSkill,
    updateRemoteSkill,
    removeRemoteSkill,
  };
}
