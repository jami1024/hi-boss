/**
 * Token authentication middleware for Web API.
 *
 * Reuses DaemonContext.resolvePrincipal() for token validation.
 */

import type { ServerResponse } from "node:http";
import type { RouteContext } from "../router.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { sendJson } from "../router.js";

/**
 * Require a valid boss token from the request.
 * Returns the token string or sends 401 and returns null.
 */
export function requireBossToken(
  ctx: RouteContext,
  daemon: DaemonContext,
): string | null {
  const token = ctx.token;
  if (!token) {
    sendJson(ctx.res, 401, { error: "Authorization header required" });
    return null;
  }

  try {
    const principal = daemon.resolvePrincipal(token);
    if (principal.kind !== "boss") {
      sendJson(ctx.res, 403, { error: "Boss token required" });
      return null;
    }
    return token;
  } catch {
    sendJson(ctx.res, 401, { error: "Invalid token" });
    return null;
  }
}

/**
 * Require a valid token (boss or agent) from the request.
 * Returns the token string or sends 401 and returns null.
 */
export function requireToken(
  ctx: RouteContext,
  daemon: DaemonContext,
): string | null {
  const token = ctx.token;
  if (!token) {
    sendJson(ctx.res, 401, { error: "Authorization header required" });
    return null;
  }

  try {
    daemon.resolvePrincipal(token);
    return token;
  } catch {
    sendJson(ctx.res, 401, { error: "Invalid token" });
    return null;
  }
}

/**
 * CORS headers for browser requests.
 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
