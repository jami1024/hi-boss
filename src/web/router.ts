/**
 * Lightweight REST router for Hi-Boss Web API.
 *
 * No external dependencies — built on Node.js `http` module.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  token: string | null;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

/**
 * Parse a route pattern like `/api/v1/agents/:name/status` into a RegExp.
 */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
      paramNames.push(name);
      return "([^/]+)";
    })
    .replace(/\*/g, "(.*)");
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

/**
 * Parse query string from URL.
 */
function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  const result: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    const [key, value] = pair.split("=");
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return result;
}

/**
 * Read request body as JSON.
 */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Extract bearer token from Authorization header.
 */
function extractToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

export class Router {
  private routes: Route[] = [];

  get(pattern: string, handler: RouteHandler): void {
    this.addRoute("GET", pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): void {
    this.addRoute("POST", pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): void {
    this.addRoute("PUT", pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): void {
    this.addRoute("DELETE", pattern, handler);
  }

  private addRoute(method: string, pattern: string, handler: RouteHandler): void {
    const { regex, paramNames } = compilePattern(pattern);
    this.routes.push({ method, pattern: regex, paramNames, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = (req.method ?? "GET").toUpperCase();
    const urlPath = (req.url ?? "/").split("?")[0]!;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = urlPath.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]!] = decodeURIComponent(match[i + 1] ?? "");
      }

      const body = method === "GET" || method === "HEAD"
        ? undefined
        : await readBody(req).catch(() => undefined);

      const ctx: RouteContext = {
        req,
        res,
        params,
        query: parseQuery(req.url ?? ""),
        body,
        token: extractToken(req),
      };

      try {
        await route.handler(ctx);
      } catch (err) {
        const error = err as Error & { code?: number };
        const status = error.code === -32001 ? 401
          : error.code === -32002 ? 404
          : error.code === -32003 ? 409
          : error.code === -32602 ? 400
          : 500;
        sendJson(res, status, { error: error.message });
      }

      return true;
    }

    return false;
  }
}

/**
 * Send a JSON response.
 */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
