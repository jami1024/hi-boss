import { parseAddress } from "../adapters/types.js";
import type { Envelope } from "../envelope/types.js";
import { DEFAULT_AGENT_PERMISSION_LEVEL } from "../shared/defaults.js";
import type { PermissionLevel } from "../shared/permissions.js";

export type ProviderExecutionMode = "full-access" | "workspace-sandbox";

export interface ResolvedExecutionPolicy {
  mode: ProviderExecutionMode;
  reason:
    | "project-scoped-sandbox"
    | "untrusted-channel-input"
    | "trusted-agent-input"
    | "trusted-boss-channel-input"
    | "read-search-bypass"
    | "background-read-search-bypass"
    | "default-safe-mode"
    | "background-safe-default";
}

const READ_SEARCH_PATTERN =
  /\b(read|open|show|view|inspect|search|find|locate|list|grep|ripgrep|glob|ls|cat|head|tail)\b|读取|查找|搜索|查看|列出/i;

const MUTATING_PATTERN =
  /\b(write|edit|modify|delete|remove|rename|move|create|mkdir|touch|install|run|execute|build|test|commit|push|rebase|reset|patch|apply|rm|mv)\b|修改|删除|重命名|创建|安装|运行|构建|测试|提交|推送/i;

function normalizePermissionLevel(level?: PermissionLevel): PermissionLevel {
  return level ?? DEFAULT_AGENT_PERMISSION_LEVEL;
}

function tryParseAddress(value: string): ReturnType<typeof parseAddress> | null {
  try {
    return parseAddress(value);
  } catch {
    return null;
  }
}

function hasUntrustedChannelInput(envelopes: Envelope[]): boolean {
  for (const envelope of envelopes) {
    const from = tryParseAddress(envelope.from);
    if (!from) {
      return true;
    }
    if (from.type === "channel" && !envelope.fromBoss) {
      return true;
    }
  }
  return false;
}

function hasProjectScopedContext(envelopes: Envelope[]): boolean {
  for (const envelope of envelopes) {
    const metadata = envelope.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const projectId = (metadata as Record<string, unknown>).projectId;
    if (typeof projectId === "string" && projectId.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function hasTrustedBossChannelInput(envelopes: Envelope[]): boolean {
  for (const envelope of envelopes) {
    const from = tryParseAddress(envelope.from);
    if (from && from.type === "channel" && envelope.fromBoss) {
      return true;
    }
  }
  return false;
}

function hasOnlyTrustedAgentInput(envelopes: Envelope[]): boolean {
  if (envelopes.length === 0) return false;
  for (const envelope of envelopes) {
    const from = tryParseAddress(envelope.from);
    if (!from || from.type !== "agent") {
      return false;
    }
  }
  return true;
}

function collectEnvelopeText(envelopes: Envelope[]): string {
  return envelopes
    .map((envelope) => envelope.content.text?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("\n")
    .toLowerCase();
}

function isReadSearchOnlyText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (MUTATING_PATTERN.test(normalized)) return false;
  return READ_SEARCH_PATTERN.test(normalized);
}

export function resolveTurnExecutionPolicy(params: {
  permissionLevel?: PermissionLevel;
  envelopes: Envelope[];
}): ResolvedExecutionPolicy {
  const permissionLevel = normalizePermissionLevel(params.permissionLevel);
  if (hasProjectScopedContext(params.envelopes)) {
    return {
      mode: "workspace-sandbox",
      reason: "project-scoped-sandbox",
    };
  }

  if (hasUntrustedChannelInput(params.envelopes)) {
    return {
      mode: "workspace-sandbox",
      reason: "untrusted-channel-input",
    };
  }

  if (permissionLevel !== "restricted" && hasOnlyTrustedAgentInput(params.envelopes)) {
    return {
      mode: "full-access",
      reason: "trusted-agent-input",
    };
  }

  if (permissionLevel !== "restricted" && hasTrustedBossChannelInput(params.envelopes)) {
    return {
      mode: "full-access",
      reason: "trusted-boss-channel-input",
    };
  }

  if (permissionLevel !== "restricted" && isReadSearchOnlyText(collectEnvelopeText(params.envelopes))) {
    return {
      mode: "full-access",
      reason: "read-search-bypass",
    };
  }

  return {
    mode: "workspace-sandbox",
    reason: "default-safe-mode",
  };
}

export function resolveBackgroundExecutionPolicy(params: {
  permissionLevel?: PermissionLevel;
  prompt: string;
}): ResolvedExecutionPolicy {
  const level = normalizePermissionLevel(params.permissionLevel);
  if (level !== "restricted" && isReadSearchOnlyText(params.prompt.toLowerCase())) {
    return {
      mode: "full-access",
      reason: "background-read-search-bypass",
    };
  }

  return {
    mode: "workspace-sandbox",
    reason: "background-safe-default",
  };
}

export function getClaudePermissionMode(mode: ProviderExecutionMode): "bypassPermissions" | "default" {
  return mode === "full-access" ? "bypassPermissions" : "default";
}

export function getCodexExecutionArgs(mode: ProviderExecutionMode): string[] {
  if (mode === "full-access") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  return ["--ask-for-approval", "never", "--sandbox", "workspace-write"];
}
