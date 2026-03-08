import * as fs from "node:fs";
import * as path from "node:path";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { requireBossToken } from "../middleware/auth.js";
import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";

const PROJECT_MEMORY_ENTRY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.md$/;

interface ProjectMemoryEntry {
  name: string;
  size: number;
  updatedAt: number;
}

interface SessionRefreshSummary {
  count: number;
  requested: Array<{ agentName: string; scope: "project"; projectId: string }>;
}

function resolveProjectMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, ".hiboss", "memory");
}

function normalizeEntryName(raw: string | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim();
  if (!PROJECT_MEMORY_ENTRY_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function resolveMemoryFilePath(projectRoot: string, entryName: string): string {
  const memoryDir = resolveProjectMemoryDir(projectRoot);
  const resolvedDir = path.resolve(memoryDir);
  const resolvedFile = path.resolve(memoryDir, entryName);
  if (!resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
    throw new Error("Invalid memory entry path");
  }
  return resolvedFile;
}

function listProjectMemoryEntries(projectRoot: string): ProjectMemoryEntry[] {
  const memoryDir = resolveProjectMemoryDir(projectRoot);
  if (!fs.existsSync(memoryDir)) return [];

  const entries = fs
    .readdirSync(memoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((entryName) => PROJECT_MEMORY_ENTRY_PATTERN.test(entryName))
    .sort((a, b) => a.localeCompare(b))
    .map((entryName) => {
      const absolutePath = path.join(memoryDir, entryName);
      const stats = fs.statSync(absolutePath);
      return {
        name: entryName,
        size: stats.size,
        updatedAt: stats.mtimeMs,
      } satisfies ProjectMemoryEntry;
    });

  return entries;
}

function requestProjectSessionRefresh(daemon: DaemonContext, projectId: string, reason: string): SessionRefreshSummary {
  const project = daemon.db.getProjectById(projectId);
  if (!project) {
    return { count: 0, requested: [] };
  }

  const members = new Set<string>([
    project.speakerAgent,
    ...daemon.db.listProjectLeaders(project.id, { activeOnly: false }).map((leader) => leader.agentName),
  ]);

  const requested: SessionRefreshSummary["requested"] = [];
  for (const agentName of members) {
    daemon.executor.requestSessionRefresh(agentName, reason, "project", project.id);
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

export function createProjectMemoryHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  const listMemory: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    sendJson(ctx.res, 200, {
      entries: listProjectMemoryEntries(project.root),
    });
  };

  const getMemoryEntry: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const entryName = normalizeEntryName(ctx.params.entryName);
    if (!id || !entryName) {
      sendJson(ctx.res, 400, { error: "Project ID and valid entry name required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    try {
      const filePath = resolveMemoryFilePath(project.root, entryName);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(ctx.res, 404, { error: "Memory entry not found" });
        return;
      }

      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf8");
      sendJson(ctx.res, 200, {
        entry: {
          name: entryName,
          size: stats.size,
          updatedAt: stats.mtimeMs,
          content,
        },
      });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  const upsertMemoryEntry: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const entryName = normalizeEntryName(ctx.params.entryName);
    if (!id || !entryName) {
      sendJson(ctx.res, 400, { error: "Project ID and valid entry name required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }
    if (typeof body.content !== "string") {
      sendJson(ctx.res, 400, { error: "content is required" });
      return;
    }

    try {
      const memoryDir = resolveProjectMemoryDir(project.root);
      fs.mkdirSync(memoryDir, { recursive: true });

      const filePath = resolveMemoryFilePath(project.root, entryName);
      fs.writeFileSync(filePath, body.content, "utf8");
      const stats = fs.statSync(filePath);
      const refresh = requestProjectSessionRefresh(daemon, project.id, "web:project.memory.upsert");

      sendJson(ctx.res, 200, {
        entry: {
          name: entryName,
          size: stats.size,
          updatedAt: stats.mtimeMs,
          content: body.content,
        },
        refresh,
      });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  const deleteMemoryEntry: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const entryName = normalizeEntryName(ctx.params.entryName);
    if (!id || !entryName) {
      sendJson(ctx.res, 400, { error: "Project ID and valid entry name required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    try {
      const filePath = resolveMemoryFilePath(project.root, entryName);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(ctx.res, 404, { error: "Memory entry not found" });
        return;
      }

      fs.unlinkSync(filePath);
      const refresh = requestProjectSessionRefresh(daemon, project.id, "web:project.memory.delete");
      sendJson(ctx.res, 200, {
        success: true,
        entryName,
        refresh,
      });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  return {
    listMemory,
    getMemoryEntry,
    upsertMemoryEntry,
    deleteMemoryEntry,
  };
}
