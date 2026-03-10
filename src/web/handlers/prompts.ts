/**
 * Prompt template API handlers for the web UI.
 *
 * Provides browsing and editing of Nunjucks templates in `prompts/`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { resolvePromptsDir } from "../../shared/prompt-renderer.js";

interface PromptFileEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: PromptFileEntry[];
}

function buildTree(dir: string, basePath: string = ""): PromptFileEntry[] {
  const entries: PromptFileEntry[] = [];

  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  // Sort: directories first, then files, alphabetical
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    const relativePath = basePath ? `${basePath}/${item.name}` : item.name;

    if (item.isDirectory()) {
      entries.push({
        path: relativePath,
        name: item.name,
        type: "directory",
        children: buildTree(path.join(dir, item.name), relativePath),
      });
    } else if (item.name.endsWith(".md")) {
      entries.push({
        path: relativePath,
        name: item.name,
        type: "file",
      });
    }
  }

  return entries;
}

export function createPromptHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  let promptsDir: string | null = null;

  function getPromptsDir(): string {
    if (!promptsDir) {
      promptsDir = resolvePromptsDir();
    }
    return promptsDir;
  }

  /**
   * Validate and resolve a template path, preventing directory traversal.
   */
  function resolveSafePath(templatePath: string): string | null {
    const dir = getPromptsDir();
    const resolved = path.resolve(dir, templatePath);
    if (!resolved.startsWith(dir + path.sep) && resolved !== dir) {
      return null;
    }
    if (!resolved.endsWith(".md")) {
      return null;
    }
    return resolved;
  }

  /**
   * GET /api/v1/prompts
   *
   * List all prompt template files as a tree.
   */
  const listPrompts: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const dir = getPromptsDir();
    const tree = buildTree(dir);

    sendJson(ctx.res, 200, { promptsDir: dir, tree });
  };

  /**
   * GET /api/v1/prompts/file?path=system/base.md
   *
   * Read a specific prompt template file.
   */
  const getPrompt: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const templatePath = ctx.query.path;
    if (!templatePath) {
      sendJson(ctx.res, 400, { error: "path query parameter required" });
      return;
    }

    const resolved = resolveSafePath(templatePath);
    if (!resolved) {
      sendJson(ctx.res, 400, { error: "Invalid template path" });
      return;
    }

    if (!fs.existsSync(resolved)) {
      sendJson(ctx.res, 404, { error: "Template not found" });
      return;
    }

    const content = fs.readFileSync(resolved, "utf-8");
    sendJson(ctx.res, 200, { path: templatePath, content });
  };

  /**
   * PUT /api/v1/prompts/file
   *
   * Update a prompt template file.
   * Body: { path: string, content: string }
   */
  const updatePrompt: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const templatePath = typeof body.path === "string" ? body.path : "";
    if (!templatePath) {
      sendJson(ctx.res, 400, { error: "path is required" });
      return;
    }

    if (typeof body.content !== "string") {
      sendJson(ctx.res, 400, { error: "content is required" });
      return;
    }

    const resolved = resolveSafePath(templatePath);
    if (!resolved) {
      sendJson(ctx.res, 400, { error: "Invalid template path" });
      return;
    }

    if (!fs.existsSync(resolved)) {
      sendJson(ctx.res, 404, { error: "Template not found" });
      return;
    }

    fs.writeFileSync(resolved, body.content, "utf-8");
    sendJson(ctx.res, 200, { path: templatePath, content: body.content });
  };

  return { listPrompts, getPrompt, updatePrompt };
}
