import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { IpcClient } from "./ipc-client.js";
import { registerAgentCommands } from "./cli-agent.js";
import { agentStatus, refreshAgent } from "./commands/agent.js";

test("registerAgentCommands exposes agent refresh with --project-id", () => {
  const program = new Command();
  registerAgentCommands(program);

  const agentCommand = program.commands.find((command) => command.name() === "agent");
  assert.ok(agentCommand);

  const refreshCommand = agentCommand.commands.find((command) => command.name() === "refresh");
  assert.ok(refreshCommand);
  assert.ok(refreshCommand.options.some((option) => option.long === "--name"));
  assert.ok(refreshCommand.options.some((option) => option.long === "--project-id"));
});

test("refreshAgent forwards optional projectId to agent.refresh RPC", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const logs: string[] = [];

  const originalCall = IpcClient.prototype.call;
  const originalLog = console.log;

  IpcClient.prototype.call = async function <T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    calls.push({ method, params });
    return { success: true, agentName: "nex" } as T;
  };

  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await refreshAgent({ token: "boss-token", name: "nex", projectId: "repo.a" });
  } finally {
    IpcClient.prototype.call = originalCall;
    console.log = originalLog;
  }

  assert.deepEqual(calls, [
    {
      method: "agent.refresh",
      params: {
        token: "boss-token",
        agentName: "nex",
        projectId: "repo.a",
      },
    },
  ]);
  assert.deepEqual(logs, ["success: true", "agent-name: nex"]);
});

test("refreshAgent omits projectId when not provided", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  const originalCall = IpcClient.prototype.call;
  const originalLog = console.log;

  IpcClient.prototype.call = async function <T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    calls.push({ method, params });
    return { success: true, agentName: "nex" } as T;
  };

  console.log = () => undefined;

  try {
    await refreshAgent({ token: "boss-token", name: "nex" });
  } finally {
    IpcClient.prototype.call = originalCall;
    console.log = originalLog;
  }

  assert.deepEqual(calls, [
    {
      method: "agent.refresh",
      params: {
        token: "boss-token",
        agentName: "nex",
      },
    },
  ]);
});

test("agentStatus prints current-session-target and current-project-id when present", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const logs: string[] = [];

  const originalCall = IpcClient.prototype.call;
  const originalLog = console.log;

  IpcClient.prototype.call = async function <T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    calls.push({ method, params });

    if (method === "daemon.time") {
      return {
        bossTimezone: "Asia/Shanghai",
        daemonTimezone: "Asia/Shanghai",
      } as T;
    }

    if (method === "agent.status") {
      return {
        agent: { name: "nex", role: "speaker" },
        bindings: [],
        effective: {
          workspace: "/tmp/ws",
          provider: "codex",
          permissionLevel: "standard",
        },
        status: {
          agentState: "running",
          agentHealth: "ok",
          pendingCount: 1,
          currentRun: {
            id: "12345678123456781234567812345678",
            startedAt: 1735689600000,
            sessionTarget: "nex:repo.a",
            projectId: "repo.a",
          },
          lastRun: {
            id: "22345678123456781234567812345678",
            startedAt: 1735689600000,
            completedAt: 1735689660000,
            status: "completed",
            contextLength: 321,
          },
        },
      } as T;
    }

    throw new Error(`Unexpected method: ${method}`);
  };

  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await agentStatus({ token: "boss-token", name: "nex" });
  } finally {
    IpcClient.prototype.call = originalCall;
    console.log = originalLog;
  }

  assert.ok(calls.some((call) => call.method === "daemon.time"));
  assert.ok(calls.some((call) => call.method === "agent.status"));
  assert.ok(logs.some((line) => line.startsWith("current-session-target: nex:repo.a")));
  assert.ok(logs.some((line) => line.startsWith("current-project-id: repo.a")));
});
