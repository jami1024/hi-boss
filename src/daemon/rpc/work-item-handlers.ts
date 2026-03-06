import type {
  RpcMethodRegistry,
  WorkItemGetParams,
  WorkItemListParams,
  WorkItemUpdateParams,
} from "../ipc/types.js";
import { RPC_ERRORS } from "../ipc/types.js";
import type { DaemonContext } from "./context.js";
import { requireToken, rpcError } from "./context.js";
import { formatChannelAddress, parseAddress } from "../../adapters/types.js";
import { parseAgentRoleFromMetadata } from "../../shared/agent-role.js";
import {
  canRoleSetWorkItemState,
  canTransitionWorkItemState,
  isWorkItemState,
  normalizeWorkItemId,
  normalizeWorkItemTitle,
} from "../../shared/work-item.js";

function requireAgentRole(agentName: string, metadata: Record<string, unknown> | undefined): "speaker" | "leader" {
  const role = parseAgentRoleFromMetadata(metadata);
  if (!role) {
    rpcError(
      RPC_ERRORS.INTERNAL_ERROR,
      `Agent '${agentName}' is missing required role metadata. Run: hiboss agent set --name ${agentName} --role <speaker|leader>`
    );
  }
  return role;
}

function parseChannelAddressList(value: unknown, flag: string): string[] {
  if (value === undefined || value === null) return [];
  const rawList = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawList) {
    if (typeof raw !== "string" || !raw.trim()) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, `Invalid ${flag}`);
    }
    let parsed: ReturnType<typeof parseAddress>;
    try {
      parsed = parseAddress(raw.trim());
    } catch (err) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        err instanceof Error ? `Invalid ${flag}: ${err.message}` : `Invalid ${flag}`
      );
    }
    if (parsed.type !== "channel") {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        `Invalid ${flag}: expected channel:<adapter>:<chat-id>`
      );
    }
    const normalized = formatChannelAddress(parsed.adapter, parsed.chatId);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function createWorkItemHandlers(ctx: DaemonContext): RpcMethodRegistry {
  const createWorkItemList = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as WorkItemListParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    if (principal.kind !== "agent") {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Access denied");
    }
    ctx.db.updateAgentLastSeen(principal.agent.name);

    const state = (() => {
      if (p.state === undefined) return undefined;
      if (typeof p.state !== "string" || !isWorkItemState(p.state)) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Invalid state (expected new, triaged, in-progress, awaiting-user, blocked, done, archived)"
        );
      }
      return p.state;
    })();

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

    const items = ctx.db.listWorkItems({ state, limit }).map((item) => ({
      ...item,
      channelAllowlist: ctx.db.listChannelAddressesForWorkItem(item.id),
    }));

    return { items };
  };

  const createWorkItemGet = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as WorkItemGetParams;
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
    const id = normalizeWorkItemId(p.id);
    if (!id) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        "Invalid id (expected lowercase letters/numbers with optional . _ : -)"
      );
    }

    const item = ctx.db.getWorkItemById(id);
    if (!item) {
      rpcError(RPC_ERRORS.NOT_FOUND, "Work item not found");
    }

    return {
      item: {
        ...item,
        channelAllowlist: ctx.db.listChannelAddressesForWorkItem(item.id),
      },
    };
  };

  const createWorkItemUpdate = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as WorkItemUpdateParams;
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
    const id = normalizeWorkItemId(p.id);
    if (!id) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        "Invalid id (expected lowercase letters/numbers with optional . _ : -)"
      );
    }

    const existing = ctx.db.getWorkItemById(id);
    if (!existing) {
      rpcError(RPC_ERRORS.NOT_FOUND, "Work item not found");
    }

    const state = (() => {
      if (p.state === undefined) return undefined;
      if (typeof p.state !== "string" || !isWorkItemState(p.state)) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Invalid state (expected new, triaged, in-progress, awaiting-user, blocked, done, archived)"
        );
      }
      return p.state;
    })();

    if (p.clearTitle !== undefined && typeof p.clearTitle !== "boolean") {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid clear-title");
    }
    if (p.clearTitle && p.title !== undefined) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "title and clear-title cannot be used together");
    }

    const title = (() => {
      if (p.clearTitle) return null;
      if (p.title === undefined) return undefined;
      if (typeof p.title !== "string") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid title");
      }
      const normalized = normalizeWorkItemTitle(p.title);
      if (!normalized) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid title (expected non-empty title up to 200 chars)");
      }
      return normalized;
    })();

    const addChannels = parseChannelAddressList(p.addChannels, "add-channels");
    const removeChannels = parseChannelAddressList(p.removeChannels, "remove-channels");
    const removeSet = new Set(removeChannels);
    for (const channelAddress of addChannels) {
      if (removeSet.has(channelAddress)) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "add-channels and remove-channels cannot contain the same address"
        );
      }
    }

    if (state === undefined && title === undefined && addChannels.length === 0 && removeChannels.length === 0) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        "Provide at least one field to update (state/title/clear-title/add-channels/remove-channels)"
      );
    }

    const role = requireAgentRole(principal.agent.name, principal.agent.metadata);

    if ((addChannels.length > 0 || removeChannels.length > 0) && role !== "leader") {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Only leader role can modify work item channel allowlist");
    }

    if (state !== undefined) {
      if (!canRoleSetWorkItemState(role, state)) {
        rpcError(RPC_ERRORS.UNAUTHORIZED, "Only leader role can transition work item to done");
      }
      if (!canTransitionWorkItemState(existing.state, state)) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          `Invalid state transition (${existing.state} -> ${state})`
        );
      }
    }

    try {
      const item = ctx.db.runInTransaction(() => {
        const updatedItem = ctx.db.updateWorkItem({ id, state, title });
        for (const channelAddress of removeChannels) {
          ctx.db.removeChannelAddressFromWorkItemAllowlist(id, channelAddress);
        }
        for (const channelAddress of addChannels) {
          ctx.db.addChannelAddressToWorkItemAllowlist({
            workItemId: id,
            channelAddress,
            createdByAgent: principal.agent.name,
          });
        }
        if (addChannels.length > 0 || removeChannels.length > 0) {
          ctx.db.setWorkItemChannelAllowlistStrict(id, true);
        }

        return {
          ...updatedItem,
          channelAllowlist: ctx.db.listChannelAddressesForWorkItem(id),
        };
      });

      return { item };
    } catch (err) {
      if (err instanceof Error && err.message === "Work item not found") {
        rpcError(RPC_ERRORS.NOT_FOUND, err.message);
      }
      rpcError(RPC_ERRORS.INTERNAL_ERROR, err instanceof Error ? err.message : "Failed to update work item");
    }
  };

  return {
    "work-item.list": createWorkItemList("work-item.list"),
    "work-item.get": createWorkItemGet("work-item.get"),
    "work-item.update": createWorkItemUpdate("work-item.update"),
  };
}
