import type { AgentRole } from "./agent-role.js";

export const WORK_ITEM_STATES = [
  "new",
  "triaged",
  "in-progress",
  "awaiting-user",
  "blocked",
  "done",
  "archived",
] as const;

export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export interface WorkItem {
  id: string;
  state: WorkItemState;
  title?: string;
  projectId?: string;
  projectRoot?: string;
  orchestratorAgent?: string;
  mainGroupChannel?: string;
  requirementGroupChannel?: string;
  specialists?: string[];
  channelAllowlist?: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface WorkItemSpecialistAssignment {
  workItemId: string;
  agentName: string;
  capability?: string;
  assignedBy?: string;
  assignedAt: number;
}

export interface WorkItemTransition {
  id: string;
  workItemId: string;
  fromState?: WorkItemState;
  toState: WorkItemState;
  actor?: string;
  reason?: string;
  createdAt: number;
}

const WORK_ITEM_INITIAL_STATES: readonly WorkItemState[] = [
  "new",
  "triaged",
  "in-progress",
  "awaiting-user",
  "blocked",
];

const WORK_ITEM_ALLOWED_TRANSITIONS: Record<WorkItemState, readonly WorkItemState[]> = {
  new: ["triaged", "in-progress", "blocked", "archived"],
  triaged: ["in-progress", "blocked", "archived"],
  "in-progress": ["awaiting-user", "blocked", "done", "archived"],
  "awaiting-user": ["in-progress", "blocked", "done", "archived"],
  blocked: ["triaged", "in-progress", "awaiting-user", "archived"],
  done: ["in-progress", "archived"],
  archived: [],
};

export interface WorkItemEnvelopeFields {
  workItemId?: string;
  workItemState?: WorkItemState;
  workItemTitle?: string;
}

export interface WorkItemChannelPolicyDecision {
  allowed: boolean;
  extendsAllowlist: boolean;
}

const WORK_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,63}$/;
const WORK_ITEM_TITLE_MAX_CHARS = 200;

export function isWorkItemState(value: string): value is WorkItemState {
  return WORK_ITEM_STATES.includes(value as WorkItemState);
}

export function canStartWorkItemWithState(state: WorkItemState): boolean {
  return WORK_ITEM_INITIAL_STATES.includes(state);
}

export function canTransitionWorkItemState(from: WorkItemState, to: WorkItemState): boolean {
  if (from === to) return true;
  return WORK_ITEM_ALLOWED_TRANSITIONS[from].includes(to);
}

export function requiresOrchestratorApprovalForState(state: WorkItemState): boolean {
  return state === "done";
}

export function canRoleSetWorkItemState(role: AgentRole, state: WorkItemState): boolean {
  if (!requiresOrchestratorApprovalForState(state)) return true;
  return role === "leader";
}

export function normalizeWorkItemId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!WORK_ITEM_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

export function normalizeWorkItemTitle(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > WORK_ITEM_TITLE_MAX_CHARS) return null;
  return normalized;
}

export function extractWorkItemEnvelopeFields(metadata: unknown): WorkItemEnvelopeFields {
  if (!metadata || typeof metadata !== "object") return {};
  const m = metadata as Record<string, unknown>;

  const workItemId =
    typeof m.workItemId === "string"
      ? normalizeWorkItemId(m.workItemId) ?? undefined
      : undefined;
  const workItemState =
    typeof m.workItemState === "string" && isWorkItemState(m.workItemState)
      ? m.workItemState
      : undefined;
  const workItemTitle =
    typeof m.workItemTitle === "string"
      ? normalizeWorkItemTitle(m.workItemTitle) ?? undefined
      : undefined;

  const result: WorkItemEnvelopeFields = {};
  if (workItemId) result.workItemId = workItemId;
  if (workItemState) result.workItemState = workItemState;
  if (workItemTitle) result.workItemTitle = workItemTitle;
  return result;
}

export function mergeWorkItemEnvelopeFields(params: {
  metadata: Record<string, unknown>;
  fields: WorkItemEnvelopeFields;
}): Record<string, unknown> {
  const metadata = { ...params.metadata };
  const { fields } = params;
  if (fields.workItemId) metadata.workItemId = fields.workItemId;
  if (fields.workItemState) metadata.workItemState = fields.workItemState;
  if (fields.workItemTitle) metadata.workItemTitle = fields.workItemTitle;
  return metadata;
}

export function resolveWorkItemChannelPolicy(params: {
  senderRole: AgentRole;
  destinationChannelAddress: string;
  knownChannelAddresses: string[];
  strictAllowlist: boolean;
}): WorkItemChannelPolicyDecision {
  const known = new Set(params.knownChannelAddresses);
  if (params.strictAllowlist) {
    if (known.has(params.destinationChannelAddress)) {
      return {
        allowed: true,
        extendsAllowlist: false,
      };
    }
    if (params.senderRole === "leader") {
      return {
        allowed: true,
        extendsAllowlist: true,
      };
    }
    return {
      allowed: false,
      extendsAllowlist: false,
    };
  }

  if (known.has(params.destinationChannelAddress)) {
    return {
      allowed: true,
      extendsAllowlist: false,
    };
  }

  if (known.size === 0) {
    return {
      allowed: true,
      extendsAllowlist: true,
    };
  }

  if (params.senderRole === "leader") {
    return {
      allowed: true,
      extendsAllowlist: true,
    };
  }

  return {
    allowed: false,
    extendsAllowlist: false,
  };
}
