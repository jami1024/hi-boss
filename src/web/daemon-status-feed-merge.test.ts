import assert from "node:assert/strict";
import test from "node:test";
import { mergeAgentWsStatusIntoDaemonStatus } from "../../web/src/lib/daemon-status-feed.js";

type DaemonStatusState = NonNullable<Parameters<typeof mergeAgentWsStatusIntoDaemonStatus>[0]>;
type AgentStatusState = Parameters<typeof mergeAgentWsStatusIntoDaemonStatus>[2];

function createDaemonStatus(): DaemonStatusState {
  return {
    running: true,
    startTimeMs: 1735689600000,
    uptime: 120000,
    bossName: "boss",
    bossTimezone: "Asia/Shanghai",
    agentCount: 2,
    bindingCount: 1,
    agents: [
      {
        name: "nex",
        role: "speaker",
        provider: "codex",
        state: "idle",
        health: "unknown",
        pendingCount: 0,
      },
      {
        name: "kai",
        role: "leader",
        provider: "codex",
        state: "running",
        health: "ok",
        pendingCount: 1,
      },
    ],
  };
}

function createAgentStatus(overrides: Partial<AgentStatusState> = {}): AgentStatusState {
  return {
    agentState: "running",
    agentHealth: "ok",
    pendingCount: 2,
    currentRun: {
      id: "12345678123456781234567812345678",
      startedAt: 1735689700000,
      sessionTarget: "nex:repo.a",
      projectId: "repo.a",
    },
    ...overrides,
  };
}

test("merge helper returns null when daemon status is null", () => {
  const next = mergeAgentWsStatusIntoDaemonStatus(null, "nex", createAgentStatus());
  assert.equal(next, null);
});

test("merge helper returns original object when target agent does not exist", () => {
  const prev = createDaemonStatus();
  const next = mergeAgentWsStatusIntoDaemonStatus(prev, "missing", createAgentStatus());
  assert.equal(next, prev);
});

test("merge helper updates matching agent and preserves unrelated agent", () => {
  const prev = createDaemonStatus();
  const next = mergeAgentWsStatusIntoDaemonStatus(prev, "nex", createAgentStatus());

  assert.ok(next);
  assert.notEqual(next, prev);
  assert.equal(next?.agents[0]?.name, "nex");
  assert.equal(next?.agents[0]?.state, "running");
  assert.equal(next?.agents[0]?.health, "ok");
  assert.equal(next?.agents[0]?.pendingCount, 2);
  assert.equal(next?.agents[0]?.currentRun?.sessionTarget, "nex:repo.a");
  assert.equal(next?.agents[0]?.currentRun?.projectId, "repo.a");

  assert.equal(next?.agents[1]?.name, "kai");
  assert.equal(next?.agents[1]?.state, "running");
  assert.equal(next?.agents[1]?.pendingCount, 1);
});

test("merge helper clears currentRun when incoming status has no run", () => {
  const prev = createDaemonStatus();
  prev.agents[0] = {
    ...prev.agents[0],
    currentRun: {
      id: "oldrun",
      startedAt: 1735689650000,
      sessionTarget: "nex:repo.old",
      projectId: "repo.old",
    },
  };

  const next = mergeAgentWsStatusIntoDaemonStatus(
    prev,
    "nex",
    createAgentStatus({ agentState: "idle", pendingCount: 0, currentRun: undefined })
  );

  assert.ok(next);
  assert.equal(next?.agents[0]?.state, "idle");
  assert.equal(next?.agents[0]?.pendingCount, 0);
  assert.equal(next?.agents[0]?.currentRun, undefined);
});
