import { createHash } from "node:crypto";
import path from "node:path";
import { parseAddress } from "../../adapters/types.js";
import type { Envelope } from "../../envelope/types.js";
import type { WorkItem } from "../../shared/work-item.js";

const PROJECT_ROOT_HINT_PATTERN = /(?:^|\n)\s*project-root\s*:\s*(.+?)\s*(?:\n|$)/i;
const CAPABILITY_HINT_PATTERN = /(?:^|\n)\s*(?:capability|specialist-capability)\s*:\s*(.+?)\s*(?:\n|$)/i;

function tryParseAddress(
  value: string
): ReturnType<typeof parseAddress> | null {
  try {
    return parseAddress(value);
  } catch {
    return null;
  }
}

export function normalizeWorkspacePath(raw: string): string {
  const resolved = path.resolve(raw.trim());
  const normalized = resolved === path.sep ? resolved : resolved.replace(/[\\/]+$/, "");
  return process.platform === "linux" ? normalized : normalized.toLowerCase();
}

export function parseProjectRootHint(text?: string): string | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const match = text.match(PROJECT_ROOT_HINT_PATTERN);
  if (!match) return undefined;
  const root = match[1]?.trim();
  if (!root) return undefined;
  if (!path.isAbsolute(root)) return undefined;
  return normalizeWorkspacePath(root);
}

export function parseCapabilityHint(text?: string): string | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const match = text.match(CAPABILITY_HINT_PATTERN);
  const capability = match?.[1]?.trim();
  return capability || undefined;
}

export function deriveProjectIdFromRoot(projectRoot: string): string {
  const normalized = normalizeWorkspacePath(projectRoot).toLowerCase();
  const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 12);
  return `prj-${digest}`;
}

export function inferMainGroupChannel(params: {
  existingWorkItem: WorkItem | null;
  replyToEnvelope: Envelope | null;
  destinationAddress: string;
}): string | undefined {
  if (params.existingWorkItem?.mainGroupChannel) {
    return params.existingWorkItem.mainGroupChannel;
  }

  if (params.replyToEnvelope) {
    const from = tryParseAddress(params.replyToEnvelope.from);
    if (from?.type === "channel") {
      return params.replyToEnvelope.from;
    }
  }

  const destination = tryParseAddress(params.destinationAddress);
  if (destination?.type === "channel") {
    return params.destinationAddress;
  }

  return undefined;
}

export function inferRequirementGroupChannel(params: {
  existingWorkItem: WorkItem | null;
  mainGroupChannel?: string;
  destinationAddress: string;
}): string | undefined {
  if (params.existingWorkItem?.requirementGroupChannel) {
    return params.existingWorkItem.requirementGroupChannel;
  }

  const destination = tryParseAddress(params.destinationAddress);
  if (!destination || destination.type !== "channel") {
    return undefined;
  }

  if (!params.mainGroupChannel || params.destinationAddress !== params.mainGroupChannel) {
    return params.destinationAddress;
  }

  return undefined;
}
