import { getDefaultConfig, getSocketPath } from "../../daemon/daemon.js";
import { IpcClient } from "../ipc-client.js";
import { resolveToken } from "../token.js";
import type { WorkItem, WorkItemState } from "../../shared/work-item.js";
import { formatUnixMsAsTimeZoneOffset } from "../../shared/time.js";
import { getDaemonTimeContext } from "../time-context.js";

interface WorkItemListResult {
  items: WorkItem[];
}

interface WorkItemGetResult {
  item: WorkItem;
}

interface WorkItemUpdateResult {
  item: WorkItem;
}

export interface WorkItemListOptions {
  token?: string;
  state?: WorkItemState;
  limit?: number;
}

export interface WorkItemGetOptions {
  token?: string;
  id: string;
}

export interface WorkItemUpdateOptions {
  token?: string;
  id: string;
  state?: WorkItemState;
  title?: string;
  clearTitle?: boolean;
  addChannels?: string[];
  removeChannels?: string[];
}

function formatWorkItem(item: WorkItem, bossTimezone: string): string {
  const lines: string[] = [];
  lines.push(`work-item-id: ${item.id}`);
  lines.push(`work-item-state: ${item.state}`);
  lines.push(`work-item-title: ${item.title ?? "(none)"}`);
  lines.push(
    `work-item-channel-allowlist: ${
      item.channelAllowlist && item.channelAllowlist.length > 0
        ? item.channelAllowlist.join(", ")
        : "(none)"
    }`
  );
  lines.push(`created-at: ${formatUnixMsAsTimeZoneOffset(item.createdAt, bossTimezone)}`);
  lines.push(
    `updated-at: ${
      typeof item.updatedAt === "number"
        ? formatUnixMsAsTimeZoneOffset(item.updatedAt, bossTimezone)
        : "(none)"
    }`
  );
  return lines.join("\n");
}

export async function listWorkItems(options: WorkItemListOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));

  try {
    const token = resolveToken(options.token);
    const time = await getDaemonTimeContext({ client, token });
    const result = await client.call<WorkItemListResult>("work-item.list", {
      token,
      state: options.state,
      limit: options.limit,
    });

    if (result.items.length === 0) {
      console.log("no-work-items: true");
      return;
    }

    for (const item of result.items) {
      console.log(formatWorkItem(item, time.bossTimezone));
      console.log();
    }
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function getWorkItem(options: WorkItemGetOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));

  try {
    const token = resolveToken(options.token);
    const time = await getDaemonTimeContext({ client, token });
    const result = await client.call<WorkItemGetResult>("work-item.get", {
      token,
      id: options.id,
    });

    console.log(formatWorkItem(result.item, time.bossTimezone));
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}

export async function updateWorkItem(options: WorkItemUpdateOptions): Promise<void> {
  const client = new IpcClient(getSocketPath(getDefaultConfig()));

  try {
    const token = resolveToken(options.token);
    const time = await getDaemonTimeContext({ client, token });
    const result = await client.call<WorkItemUpdateResult>("work-item.update", {
      token,
      id: options.id,
      state: options.state,
      title: options.title,
      clearTitle: options.clearTitle,
      addChannels: options.addChannels,
      removeChannels: options.removeChannels,
    });

    console.log(formatWorkItem(result.item, time.bossTimezone));
  } catch (err) {
    console.error("error:", (err as Error).message);
    process.exit(1);
  }
}
