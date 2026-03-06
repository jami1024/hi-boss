/**
 * Envelope and message RPC handlers.
 */

import path from "node:path";
import type {
  RpcMethodRegistry,
  EnvelopeSendParams,
  EnvelopeListParams,
  EnvelopeThreadParams,
  EnvelopeThreadResult,
} from "../ipc/types.js";
import { RPC_ERRORS } from "../ipc/types.js";
import type { DaemonContext } from "./context.js";
import { requireToken, rpcError } from "./context.js";
import { formatAgentAddress, parseAddress } from "../../adapters/types.js";
import { parseDateTimeInputToUnixMsInTimeZone } from "../../shared/time.js";
import { BACKGROUND_AGENT_NAME } from "../../shared/defaults.js";
import { parseAgentRoleFromMetadata } from "../../shared/agent-role.js";
import { logEvent } from "../../shared/daemon-log.js";
import { resolveEnvelopeIdInput } from "./resolve-envelope-id.js";
import type { Envelope } from "../../envelope/types.js";
import {
  deriveProjectIdFromRoot,
  inferMainGroupChannel,
  inferRequirementGroupChannel,
  normalizeWorkspacePath,
  parseCapabilityHint,
  parseProjectRootHint,
} from "./work-item-orchestration.js";
import {
  canRoleSetWorkItemState,
  canStartWorkItemWithState,
  canTransitionWorkItemState,
  extractWorkItemEnvelopeFields,
  isWorkItemState,
  mergeWorkItemEnvelopeFields,
  normalizeWorkItemId,
  normalizeWorkItemTitle,
  resolveWorkItemChannelPolicy,
  type WorkItemEnvelopeFields,
} from "../../shared/work-item.js";

function parseEnvelopeListTimeBoundary(params: {
  raw: unknown;
  flag: "created-after" | "created-before";
  bossTimezone: string;
}): number | undefined {
  const raw = params.raw;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    rpcError(RPC_ERRORS.INVALID_PARAMS, `Invalid ${params.flag}`);
  }
  try {
    return parseDateTimeInputToUnixMsInTimeZone(raw, params.bossTimezone);
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = rawMessage.replace(/^Invalid deliver-at:/, `Invalid ${params.flag}:`);
    rpcError(RPC_ERRORS.INVALID_PARAMS, message);
  }
}

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

function resolveComparableProjectRoot(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeWorkspacePath(value);
  } catch {
    return value.trim() || undefined;
  }
}

function deriveProjectDisplayName(projectRoot: string): string {
  const name = path.basename(projectRoot.trim());
  return name || projectRoot;
}

function parseCapabilityList(capabilityHint?: string): string[] {
  if (!capabilityHint) return [];
  return capabilityHint
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.toLowerCase())
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Create envelope RPC handlers.
 */
export function createEnvelopeHandlers(ctx: DaemonContext): RpcMethodRegistry {
  const createEnvelopeSend = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as EnvelopeSendParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    if (principal.kind === "boss") {
      rpcError(
        RPC_ERRORS.UNAUTHORIZED,
        "Boss tokens cannot send envelopes (use an agent token or send via a channel adapter)"
      );
    }

    if (typeof p.to !== "string" || !p.to.trim()) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid to");
    }

    const toInput = p.to.trim();

    let destination: ReturnType<typeof parseAddress>;
    try {
      destination = parseAddress(toInput);
    } catch (err) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, err instanceof Error ? err.message : "Invalid to");
    }

    let from: string;
    let fromBoss = false;
    const metadata: Record<string, unknown> = {};

    if (p.from !== undefined || p.fromBoss !== undefined || p.fromName !== undefined) {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Access denied");
    }

    const agent = principal.agent;
    ctx.db.updateAgentLastSeen(agent.name);
    from = formatAgentAddress(agent.name);

    const to = (() => {
      if (destination.type !== "agent") return toInput;

      if (destination.agentName.toLowerCase() === BACKGROUND_AGENT_NAME) {
        return formatAgentAddress(BACKGROUND_AGENT_NAME);
      }

      const destAgent = ctx.db.getAgentByNameCaseInsensitive(destination.agentName);
      if (!destAgent) {
        rpcError(RPC_ERRORS.NOT_FOUND, "Agent not found");
      }
      return formatAgentAddress(destAgent.name);
    })();

    // Check binding for channel destinations (agent sender only)
    if (destination.type === "channel") {
      const binding = ctx.db.getAgentBindingByType(agent.name, destination.adapter);
      if (!binding) {
        rpcError(
          RPC_ERRORS.UNAUTHORIZED,
          `Agent '${agent.name}' is not bound to adapter '${destination.adapter}'`
        );
      }
    }

    // Validate channel delivery requirements: sending to a channel requires from=agent:*
    if (destination.type === "channel") {
      let sender: ReturnType<typeof parseAddress>;
      try {
        sender = parseAddress(from);
      } catch (err) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, err instanceof Error ? err.message : "Invalid from");
      }
      if (sender.type !== "agent") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Channel destinations require from=agent:<name>");
      }
    }

    if (p.parseMode !== undefined) {
      if (typeof p.parseMode !== "string") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid parse-mode");
      }
      const mode = p.parseMode.trim();
      if (mode !== "plain" && mode !== "markdownv2" && mode !== "html") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid parse-mode (expected plain, markdownv2, or html)");
      }
      if (destination.type !== "channel") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "parse-mode is only supported for channel destinations");
      }
      metadata.parseMode = mode;
    }

    let replyToEnvelope: Envelope | null = null;
    if (p.replyToEnvelopeId !== undefined) {
      if (typeof p.replyToEnvelopeId !== "string" || !p.replyToEnvelopeId.trim()) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid reply-to-envelope-id");
      }
      const resolvedReplyToEnvelopeId = resolveEnvelopeIdInput(ctx.db, p.replyToEnvelopeId.trim());
      metadata.replyToEnvelopeId = resolvedReplyToEnvelopeId;
      replyToEnvelope = ctx.db.getEnvelopeById(resolvedReplyToEnvelopeId);
    }

    const workItemFields: WorkItemEnvelopeFields = {};
    if (p.workItemId !== undefined) {
      if (typeof p.workItemId !== "string") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid work-item-id");
      }
      const normalized = normalizeWorkItemId(p.workItemId);
      if (!normalized) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Invalid work-item-id (expected lowercase letters/numbers with optional . _ : -)"
        );
      }
      workItemFields.workItemId = normalized;
    }

    if (p.workItemState !== undefined) {
      if (typeof p.workItemState !== "string" || !isWorkItemState(p.workItemState)) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Invalid work-item-state (expected new, triaged, in-progress, awaiting-user, blocked, done, archived)"
        );
      }
      workItemFields.workItemState = p.workItemState;
    }

    if (p.workItemTitle !== undefined) {
      if (typeof p.workItemTitle !== "string") {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid work-item-title");
      }
      const normalized = normalizeWorkItemTitle(p.workItemTitle);
      if (!normalized) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid work-item-title (expected non-empty title up to 200 chars)");
      }
      workItemFields.workItemTitle = normalized;
    }

    if (!workItemFields.workItemId && replyToEnvelope) {
      const inherited = extractWorkItemEnvelopeFields(replyToEnvelope.metadata);
      if (inherited.workItemId) {
        workItemFields.workItemId = inherited.workItemId;
      }
    }

    if (!workItemFields.workItemId && (workItemFields.workItemState || workItemFields.workItemTitle)) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "work-item-state/work-item-title require --work-item-id");
    }

    let existingWorkItem = workItemFields.workItemId
      ? ctx.db.getWorkItemById(workItemFields.workItemId)
      : null;

    let senderRoleCache: "speaker" | "leader" | undefined;
    const getSenderRole = (): "speaker" | "leader" => {
      senderRoleCache ??= requireAgentRole(agent.name, agent.metadata);
      return senderRoleCache;
    };

    const replyWorkItemFields = replyToEnvelope
      ? extractWorkItemEnvelopeFields(replyToEnvelope.metadata)
      : {};
    const projectRootHint = parseProjectRootHint(p.text);
    const capabilityHint = parseCapabilityHint(p.text);
    const capabilityList = parseCapabilityList(capabilityHint);

    const senderWorkspace =
      typeof agent.workspace === "string" && agent.workspace.trim()
        ? resolveComparableProjectRoot(agent.workspace)
        : undefined;

    let effectiveProjectRoot = resolveComparableProjectRoot(existingWorkItem?.projectRoot) ?? projectRootHint;
    if (!effectiveProjectRoot && getSenderRole() === "leader") {
      effectiveProjectRoot = senderWorkspace;
    }
    const effectiveProjectId = existingWorkItem?.projectId ??
      (effectiveProjectRoot ? deriveProjectIdFromRoot(effectiveProjectRoot) : undefined);
    let effectiveOrchestratorAgent = existingWorkItem?.orchestratorAgent;
    if (!effectiveOrchestratorAgent && !existingWorkItem) {
      effectiveOrchestratorAgent = agent.name;
    } else if (!effectiveOrchestratorAgent && existingWorkItem && getSenderRole() === "speaker") {
      effectiveOrchestratorAgent = agent.name;
    }
    const effectiveMainGroupChannel = inferMainGroupChannel({
      existingWorkItem,
      replyToEnvelope,
      destinationAddress: to,
    });
    const effectiveRequirementGroupChannel = inferRequirementGroupChannel({
      existingWorkItem,
      mainGroupChannel: effectiveMainGroupChannel,
      destinationAddress: to,
    });

    if (
      workItemFields.workItemId &&
      replyToEnvelope &&
      replyWorkItemFields.workItemId &&
      replyWorkItemFields.workItemId !== workItemFields.workItemId
    ) {
      const replyWorkItem = ctx.db.getWorkItemById(replyWorkItemFields.workItemId);
      const replyProjectRoot = resolveComparableProjectRoot(replyWorkItem?.projectRoot);
      const replyProjectId = replyWorkItem?.projectId;
      const hasCurrentProjectContext = Boolean(effectiveProjectRoot) || Boolean(effectiveProjectId);
      const hasReplyProjectContext = Boolean(replyProjectRoot) || Boolean(replyProjectId);
      if (!replyWorkItem || !hasCurrentProjectContext || !hasReplyProjectContext) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Cannot verify project boundary for reply-to work item linkage"
        );
      }
      const crossProjectByRoot =
        Boolean(effectiveProjectRoot) && Boolean(replyProjectRoot) && effectiveProjectRoot !== replyProjectRoot;
      const crossProjectById =
        Boolean(effectiveProjectId) && Boolean(replyProjectId) && effectiveProjectId !== replyProjectId;
      if (crossProjectByRoot || crossProjectById) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Cross-project reply-to is not allowed when sending with work-item-id"
        );
      }
    }

    if (workItemFields.workItemId && getSenderRole() === "leader" && effectiveProjectRoot) {
      if (!senderWorkspace || senderWorkspace !== effectiveProjectRoot) {
        rpcError(
          RPC_ERRORS.UNAUTHORIZED,
          "Leader workspace does not match work item project-root"
        );
      }
    }

    if (
      workItemFields.workItemId &&
      existingWorkItem &&
      !existingWorkItem.orchestratorAgent &&
      (existingWorkItem.projectId || existingWorkItem.projectRoot) &&
      getSenderRole() !== "speaker"
    ) {
      rpcError(
        RPC_ERRORS.UNAUTHORIZED,
        "Work item orchestrator is not initialized; speaker must rebind the work item context"
      );
    }

    if (
      workItemFields.workItemId &&
      existingWorkItem &&
      (existingWorkItem.projectId || existingWorkItem.projectRoot) &&
      existingWorkItem.orchestratorAgent &&
      agent.name !== existingWorkItem.orchestratorAgent &&
      !ctx.db.isWorkItemSpecialistAssigned(workItemFields.workItemId, agent.name)
    ) {
      rpcError(
        RPC_ERRORS.UNAUTHORIZED,
        "Agent is not a member of this work item project context"
      );
    }

    if (
      workItemFields.workItemId &&
      existingWorkItem &&
      getSenderRole() === "leader" &&
      effectiveOrchestratorAgent &&
      agent.name !== effectiveOrchestratorAgent
    ) {
      if (!ctx.db.isWorkItemSpecialistAssigned(workItemFields.workItemId, agent.name)) {
        rpcError(
          RPC_ERRORS.UNAUTHORIZED,
          "Specialist leader is not assigned to this work-item-id"
        );
      }

      if (!replyToEnvelope) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Specialist leader updates require --reply-to delegated envelope"
        );
      }

      const replyToWorkItemId = replyWorkItemFields.workItemId;
      const expectedDestination = formatAgentAddress(agent.name);
      if (replyToWorkItemId !== workItemFields.workItemId || replyToEnvelope.to !== expectedDestination) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          "Specialist leader updates must reply to a delegated envelope for the same work item"
        );
      }
    }

    if (workItemFields.workItemState) {
      const role = getSenderRole();
      if (!canRoleSetWorkItemState(role, workItemFields.workItemState)) {
        rpcError(RPC_ERRORS.UNAUTHORIZED, "Only leader role can transition work item to done");
      }

      if (existingWorkItem) {
        if (!canTransitionWorkItemState(existingWorkItem.state, workItemFields.workItemState)) {
          rpcError(
            RPC_ERRORS.INVALID_PARAMS,
            `Invalid work-item-state transition (${existingWorkItem.state} -> ${workItemFields.workItemState})`
          );
        }
      } else if (!canStartWorkItemWithState(workItemFields.workItemState)) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          `Invalid work-item-state transition (none -> ${workItemFields.workItemState})`
        );
      }
    }

    if (destination.type === "channel" && workItemFields.workItemId) {
      if (!existingWorkItem) {
        existingWorkItem = ctx.db.upsertWorkItem({
          id: workItemFields.workItemId,
          state: workItemFields.workItemState,
          title: workItemFields.workItemTitle,
          projectId: effectiveProjectId,
          projectRoot: effectiveProjectRoot,
          orchestratorAgent: effectiveOrchestratorAgent,
          mainGroupChannel: effectiveMainGroupChannel,
          requirementGroupChannel: effectiveRequirementGroupChannel,
          actor: agent.name,
          reason: "envelope-send-pre-channel-policy",
        });
      }

      const knownChannels = ctx.db.listChannelAddressesForWorkItem(workItemFields.workItemId);
      const strictAllowlist = ctx.db.isWorkItemChannelAllowlistStrict(workItemFields.workItemId);
      const policy = resolveWorkItemChannelPolicy({
        senderRole: getSenderRole(),
        destinationChannelAddress: to,
        knownChannelAddresses: knownChannels,
        strictAllowlist,
      });

      if (!policy.allowed) {
        logEvent("warn", "work-item-channel-denied", {
          "agent-name": agent.name,
          "work-item-id": workItemFields.workItemId,
          to,
          "known-channels-count": knownChannels.length,
        });
        rpcError(
          RPC_ERRORS.UNAUTHORIZED,
          `Channel destination not allowed for work item '${workItemFields.workItemId}'`
        );
      }

      if (policy.extendsAllowlist && !knownChannels.includes(to)) {
        ctx.db.addChannelAddressToWorkItemAllowlist({
          workItemId: workItemFields.workItemId,
          channelAddress: to,
          createdByAgent: agent.name,
        });

        if (knownChannels.length === 0) {
          logEvent("info", "work-item-channel-allowlist-seeded", {
            "agent-name": agent.name,
            "work-item-id": workItemFields.workItemId,
            to,
            role: getSenderRole(),
          });
        } else {
          logEvent("info", "work-item-channel-allowlist-extended", {
            "agent-name": agent.name,
            "work-item-id": workItemFields.workItemId,
            to,
            role: getSenderRole(),
          });
        }
      }
    }

    if (workItemFields.workItemId) {
      const merged = mergeWorkItemEnvelopeFields({ metadata, fields: workItemFields });
      for (const [k, v] of Object.entries(merged)) {
        metadata[k] = v;
      }
    }

    let deliverAt: number | undefined;
    if (p.deliverAt) {
      try {
        deliverAt = parseDateTimeInputToUnixMsInTimeZone(p.deliverAt, ctx.db.getBossTimezone());
      } catch (err) {
        rpcError(
          RPC_ERRORS.INVALID_PARAMS,
          err instanceof Error ? err.message : "Invalid deliver-at"
        );
      }
    }

    const finalMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;

    if (workItemFields.workItemId) {
      existingWorkItem = ctx.db.upsertWorkItem({
        id: workItemFields.workItemId,
        state: workItemFields.workItemState,
        title: workItemFields.workItemTitle,
        projectId: effectiveProjectId,
        projectRoot: effectiveProjectRoot,
        orchestratorAgent: effectiveOrchestratorAgent,
        mainGroupChannel: effectiveMainGroupChannel,
        requirementGroupChannel: effectiveRequirementGroupChannel,
        actor: agent.name,
        reason: "envelope-send-upsert",
      });

      if (effectiveProjectId && effectiveProjectRoot && effectiveOrchestratorAgent) {
        ctx.db.upsertProject({
          id: effectiveProjectId,
          name: deriveProjectDisplayName(effectiveProjectRoot),
          root: effectiveProjectRoot,
          speakerAgent: effectiveOrchestratorAgent,
          mainGroupChannel: effectiveMainGroupChannel,
        });

        if (effectiveOrchestratorAgent !== agent.name && getSenderRole() === "leader") {
          ctx.db.upsertProjectLeader({
            projectId: effectiveProjectId,
            agentName: agent.name,
            capabilities: capabilityList,
            active: true,
          });
        }
      }

      if (destination.type === "agent" && getSenderRole() === "speaker") {
        const destinationAgent =
          destination.agentName.toLowerCase() === BACKGROUND_AGENT_NAME
            ? null
            : ctx.db.getAgentByNameCaseInsensitive(destination.agentName);
        if (destinationAgent && parseAgentRoleFromMetadata(destinationAgent.metadata) === "leader") {
          ctx.db.upsertWorkItemSpecialistAssignment({
            workItemId: workItemFields.workItemId,
            agentName: destinationAgent.name,
            capability: capabilityHint,
            assignedBy: agent.name,
          });

          if (effectiveProjectId) {
            ctx.db.upsertProjectLeader({
              projectId: effectiveProjectId,
              agentName: destinationAgent.name,
              capabilities: capabilityList,
              active: true,
            });
          }
        }
      }
    }

    try {
      const envelope = await ctx.router.routeEnvelope({
        from,
        to,
        fromBoss,
        content: {
          text: p.text,
          attachments: p.attachments,
        },
        deliverAt,
        metadata: finalMetadata,
      });

      ctx.scheduler.onEnvelopeCreated(envelope);
      return { id: envelope.id };
    } catch (err) {
      // Best-effort: ensure the scheduler sees newly-created scheduled envelopes, even if immediate delivery failed.
      const e = err as Error & { data?: unknown };
      if (e.data && typeof e.data === "object") {
        const id = (e.data as Record<string, unknown>).envelopeId;
        if (typeof id === "string" && id.trim()) {
          const env = ctx.db.getEnvelopeById(id.trim());
          if (env) {
            ctx.scheduler.onEnvelopeCreated(env);
          }
        }
      }
      throw err;
    }
  };

  const createEnvelopeList = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as EnvelopeListParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    const legacyAddress = (params as Record<string, unknown>).address;
    if (legacyAddress !== undefined) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "address is no longer supported");
    }

    if (principal.kind !== "agent") {
      rpcError(
        RPC_ERRORS.UNAUTHORIZED,
        "Boss tokens cannot list envelopes (use an agent token)"
      );
    }

    ctx.db.updateAgentLastSeen(principal.agent.name);
    const agentAddress = formatAgentAddress(principal.agent.name);

    const rawTo = typeof p.to === "string" ? p.to.trim() : "";
    const rawFrom = typeof p.from === "string" ? p.from.trim() : "";
    if ((rawTo && rawFrom) || (!rawTo && !rawFrom)) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Provide exactly one of: to, from");
    }

    if (p.status !== "pending" && p.status !== "done") {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid status (expected pending or done)");
    }

    let otherAddress: string;
    try {
      otherAddress = rawTo || rawFrom;
      parseAddress(otherAddress);
    } catch (err) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, err instanceof Error ? err.message : "Invalid address");
    }

    const limit = (() => {
      const v = p.limit;
      if (v === undefined || v === null) return 10;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid limit");
      }
      const n = Math.trunc(v);
      if (n <= 0) rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid limit (must be >= 1)");
      if (n > 50) rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid limit (max 50)");
      return n;
    })();

    const bossTimezone = ctx.db.getBossTimezone();
    const createdAfter = parseEnvelopeListTimeBoundary({
      raw: p.createdAfter,
      flag: "created-after",
      bossTimezone,
    });
    const createdBefore = parseEnvelopeListTimeBoundary({
      raw: p.createdBefore,
      flag: "created-before",
      bossTimezone,
    });
    if (
      typeof createdAfter === "number" &&
      typeof createdBefore === "number" &&
      createdAfter > createdBefore
    ) {
      rpcError(
        RPC_ERRORS.INVALID_PARAMS,
        "Invalid created range (expected created-after <= created-before)"
      );
    }

    const isIncoming = Boolean(rawFrom);
    const shouldAckIncomingPending = isIncoming && p.status === "pending";

    const from = isIncoming ? otherAddress : agentAddress;
    const to = isIncoming ? agentAddress : otherAddress;

    const envelopes = ctx.db.listEnvelopesByRoute({
      from,
      to,
      status: p.status,
      limit,
      dueOnly: shouldAckIncomingPending,
      createdAfter,
      createdBefore,
    });

    if (shouldAckIncomingPending && envelopes.length > 0) {
      const ids = envelopes.map((e) => e.id);
      ctx.db.markEnvelopesDone(ids);
      for (const env of envelopes) {
        env.status = "done";
      }
    }

    return { envelopes };
  };

  const createEnvelopeThread = (operation: string) => async (params: Record<string, unknown>) => {
    const p = params as unknown as EnvelopeThreadParams;
    const token = requireToken(p.token);
    const principal = ctx.resolvePrincipal(token);
    ctx.assertOperationAllowed(operation, principal);

    if (principal.kind !== "agent") {
      rpcError(RPC_ERRORS.UNAUTHORIZED, "Access denied");
    }

    if (typeof p.envelopeId !== "string" || !p.envelopeId.trim()) {
      rpcError(RPC_ERRORS.INVALID_PARAMS, "Invalid envelope-id");
    }

    ctx.db.updateAgentLastSeen(principal.agent.name);
    const resolvedId = resolveEnvelopeIdInput(ctx.db, p.envelopeId.trim());

    const maxDepth = 20;
    const chain: Envelope[] = [];
    const seen = new Set<string>();

    let currentId: string | null = resolvedId;
    let safety = 0;
    while (currentId && safety < 5000) {
      if (seen.has(currentId)) break;
      seen.add(currentId);

      const env = ctx.db.getEnvelopeById(currentId);
      if (!env) break;
      chain.push(env);

      const md = env.metadata;
      const parentRaw =
        md && typeof md === "object" ? (md as Record<string, unknown>).replyToEnvelopeId : undefined;
      const parentId = typeof parentRaw === "string" ? parentRaw.trim() : "";
      if (!parentId) break;
      currentId = parentId;
      safety++;
    }

    const totalCount = chain.length;
    const truncated = totalCount > maxDepth;
    const envelopes = truncated
      ? [...chain.slice(0, maxDepth - 1), chain[totalCount - 1]!]
      : chain;
    const truncatedIntermediateCount = truncated ? totalCount - maxDepth : 0;

    const result: EnvelopeThreadResult = {
      maxDepth,
      totalCount,
      returnedCount: envelopes.length,
      truncated,
      truncatedIntermediateCount,
      envelopes,
    };
    return result;
  };

  return {
    // Envelope methods (canonical)
    "envelope.send": createEnvelopeSend("envelope.send"),
    "envelope.list": createEnvelopeList("envelope.list"),
    "envelope.thread": createEnvelopeThread("envelope.thread"),
  };
}
