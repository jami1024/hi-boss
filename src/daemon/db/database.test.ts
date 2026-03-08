import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "./database.js";

function withTempDb(run: (db: HiBossDatabase) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-db-test-"));
  const dbPath = path.join(dir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  try {
    run(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("getAgentRoleCounts infers legacy roles from bindings", () => {
  withTempDb((db) => {
    db.registerAgent({
      name: "speakerish",
      provider: "codex",
      role: undefined,
    });
    db.registerAgent({
      name: "leaderish",
      provider: "codex",
      role: undefined,
    });

    db.createBinding("speakerish", "telegram", "123456:abcDEF");

    assert.deepEqual(db.getAgentRoleCounts(), { speaker: 1, leader: 1 });
  });
});

test("getAgentRoleCounts prefers explicit metadata.role over binding inference", () => {
  withTempDb((db) => {
    db.registerAgent({
      name: "explicit-leader",
      provider: "codex",
      role: "leader",
    });

    db.createBinding("explicit-leader", "telegram", "123456:abcDEF");

    assert.deepEqual(db.getAgentRoleCounts(), { speaker: 0, leader: 1 });
  });
});

test("upsertWorkItem creates then updates persistent work item", () => {
  withTempDb((db) => {
    const created = db.upsertWorkItem({
      id: "feature.auth.flow",
      state: "new",
      title: "Design auth workflow",
    });

    assert.equal(created.id, "feature.auth.flow");
    assert.equal(created.state, "new");
    assert.equal(created.title, "Design auth workflow");
    assert.ok(typeof created.createdAt === "number");
    assert.ok(typeof created.updatedAt === "number");

    const updated = db.upsertWorkItem({
      id: "feature.auth.flow",
      state: "in-progress",
    });

    assert.equal(updated.id, "feature.auth.flow");
    assert.equal(updated.state, "in-progress");
    assert.equal(updated.title, "Design auth workflow");

    const touched = db.upsertWorkItem({
      id: "feature.auth.flow",
    });

    assert.equal(touched.id, "feature.auth.flow");
    assert.equal(touched.state, "in-progress");
    assert.equal(touched.title, "Design auth workflow");
  });
});

test("updateWorkItem and listWorkItems work with filters", () => {
  withTempDb((db) => {
    db.upsertWorkItem({ id: "alpha.task", state: "new", title: "Alpha" });
    db.upsertWorkItem({ id: "beta.task", state: "blocked", title: "Beta" });

    const updated = db.updateWorkItem({
      id: "alpha.task",
      state: "done",
      title: null,
    });

    assert.equal(updated.state, "done");
    assert.equal(updated.title, undefined);

    const doneItems = db.listWorkItems({ state: "done", limit: 10 });
    assert.equal(doneItems.length, 1);
    assert.equal(doneItems[0]?.id, "alpha.task");

    const allItems = db.listWorkItems({ limit: 10 });
    assert.equal(allItems.length, 2);
  });
});

test("work item channel allowlist CRUD is stable and de-duplicated", () => {
  withTempDb((db) => {
    db.upsertWorkItem({
      id: "req-1",
      state: "new",
    });

    db.addChannelAddressToWorkItemAllowlist({
      workItemId: "req-1",
      channelAddress: "channel:feishu:oc_main",
      createdByAgent: "nex",
    });
    db.addChannelAddressToWorkItemAllowlist({
      workItemId: "req-1",
      channelAddress: "channel:feishu:oc_requirements",
      createdByAgent: "kai",
    });
    db.addChannelAddressToWorkItemAllowlist({
      workItemId: "req-1",
      channelAddress: "channel:feishu:oc_main",
      createdByAgent: "nex",
    });

    const channels = db.listChannelAddressesForWorkItem("req-1");
    assert.deepEqual(channels, [
      "channel:feishu:oc_main",
      "channel:feishu:oc_requirements",
    ]);

    assert.equal(
      db.removeChannelAddressFromWorkItemAllowlist("req-1", "channel:feishu:oc_requirements"),
      true
    );
    assert.equal(
      db.removeChannelAddressFromWorkItemAllowlist("req-1", "channel:feishu:oc_requirements"),
      false
    );

    assert.deepEqual(db.listChannelAddressesForWorkItem("req-1"), [
      "channel:feishu:oc_main",
    ]);
  });
});

test("work item channel allowlist strict policy can be toggled", () => {
  withTempDb((db) => {
    db.upsertWorkItem({
      id: "req-2",
      state: "new",
    });

    assert.equal(db.isWorkItemChannelAllowlistStrict("req-2"), false);
    db.setWorkItemChannelAllowlistStrict("req-2", true);
    assert.equal(db.isWorkItemChannelAllowlistStrict("req-2"), true);
    db.setWorkItemChannelAllowlistStrict("req-2", false);
    assert.equal(db.isWorkItemChannelAllowlistStrict("req-2"), false);
  });
});

test("work item specialist assignments and transitions are persisted", () => {
  withTempDb((db) => {
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
    });

    db.upsertWorkItem({
      id: "req-3",
      state: "new",
      title: "Feature 3",
      projectId: "prj-123",
      projectRoot: "/tmp/project-3",
      orchestratorAgent: "nex",
      actor: "nex",
      reason: "create",
    });

    db.upsertWorkItemSpecialistAssignment({
      workItemId: "req-3",
      agentName: "kai",
      capability: "implementation",
      assignedBy: "nex",
    });

    assert.equal(db.isWorkItemSpecialistAssigned("req-3", "kai"), true);

    const updated = db.updateWorkItem({
      id: "req-3",
      state: "in-progress",
      actor: "kai",
      reason: "started",
    });

    assert.equal(updated.projectId, "prj-123");
    assert.equal(updated.projectRoot, "/tmp/project-3");
    assert.equal(updated.orchestratorAgent, "nex");
    assert.deepEqual(updated.specialists, ["kai"]);

    const transitions = db.listWorkItemTransitions("req-3", 10);
    assert.equal(transitions.length, 2);
    assert.equal(transitions[0]?.toState, "in-progress");
    assert.equal(transitions[0]?.fromState, "new");
    assert.equal(transitions[1]?.toState, "new");
    assert.equal(transitions[1]?.fromState, undefined);
  });
});

test("project upsert and list/get return persisted fields", () => {
  withTempDb((db) => {
    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: "/tmp/repo-alpha",
    });

    const created = db.upsertProject({
      id: "repo.alpha",
      name: "repo-alpha",
      root: "/tmp/repo-alpha",
      speakerAgent: "nex",
      mainGroupChannel: "channel:feishu:oc_main_alpha",
    });

    assert.equal(created.id, "repo.alpha");
    assert.equal(created.name, "repo-alpha");
    assert.equal(created.root, "/tmp/repo-alpha");
    assert.equal(created.speakerAgent, "nex");
    assert.equal(created.mainGroupChannel, "channel:feishu:oc_main_alpha");

    const updated = db.upsertProject({
      id: "repo.alpha",
      name: "repo-alpha-v2",
      root: "/tmp/repo-alpha",
      speakerAgent: "nex",
      mainGroupChannel: "channel:feishu:oc_main_alpha_v2",
    });

    assert.equal(updated.name, "repo-alpha-v2");
    assert.equal(updated.mainGroupChannel, "channel:feishu:oc_main_alpha_v2");

    const byId = db.getProjectById("repo.alpha");
    assert.ok(byId);
    assert.equal(byId?.name, "repo-alpha-v2");

    const listed = db.listProjects({ limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "repo.alpha");
  });
});

test("project leaders normalize capabilities and support active filter", () => {
  withTempDb((db) => {
    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
      workspace: "/tmp/repo-beta",
    });
    db.registerAgent({
      name: "kai",
      provider: "codex",
      role: "leader",
      workspace: "/tmp/repo-beta",
    });
    db.registerAgent({
      name: "leo",
      provider: "codex",
      role: "leader",
      workspace: "/tmp/repo-beta",
    });

    db.upsertProject({
      id: "repo.beta",
      name: "repo-beta",
      root: "/tmp/repo-beta",
      speakerAgent: "nex",
      mainGroupChannel: "channel:feishu:oc_main_beta",
    });

    db.upsertProjectLeader({
      projectId: "repo.beta",
      agentName: "kai",
      capabilities: ["Review", "implement", "review", "  test  "],
      allowDispatchTo: ["Leo", " leo ", "NEX"],
      active: true,
    });
    db.upsertProjectLeader({
      projectId: "repo.beta",
      agentName: "leo",
      capabilities: ["design"],
      active: false,
    });

    const allLeaders = db.listProjectLeaders("repo.beta", { activeOnly: false });
    assert.equal(allLeaders.length, 2);

    const kai = allLeaders.find((leader) => leader.agentName === "kai");
    assert.ok(kai);
    assert.deepEqual(kai?.capabilities, ["implement", "review", "test"]);
    assert.deepEqual(kai?.allowDispatchTo, ["leo", "nex"]);
    assert.equal(kai?.active, true);

    db.upsertProjectLeader({
      projectId: "repo.beta",
      agentName: "kai",
      allowDispatchTo: null,
      active: true,
    });
    const kaiAfterReset = db
      .listProjectLeaders("repo.beta", { activeOnly: false })
      .find((leader) => leader.agentName === "kai");
    assert.equal(kaiAfterReset?.allowDispatchTo, undefined);

    const activeOnly = db.listProjectLeaders("repo.beta", { activeOnly: true });
    assert.equal(activeOnly.length, 1);
    assert.equal(activeOnly[0]?.agentName, "kai");

    const project = db.getProjectById("repo.beta");
    assert.ok(project);
    assert.equal(project?.leaders?.length, 2);
  });
});

test("getPendingEnvelopesForAgent batches envelopes by projectId context", () => {
  withTempDb((db) => {
    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });

    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "a-1" },
      metadata: { source: "web", projectId: "prj-a" },
    });
    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "a-2" },
      metadata: { source: "web", projectId: "prj-a" },
    });
    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "b-1" },
      metadata: { source: "web", projectId: "prj-b" },
    });
    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "free-1" },
      metadata: { source: "web" },
    });

    const firstBatch = db.getPendingEnvelopesForAgent("nex", 10);
    assert.equal(firstBatch.length, 2);
    assert.deepEqual(
      firstBatch.map((env) => (env.metadata as Record<string, unknown> | undefined)?.projectId),
      ["prj-a", "prj-a"]
    );

    db.markEnvelopesDone(firstBatch.map((env) => env.id));

    const secondBatch = db.getPendingEnvelopesForAgent("nex", 10);
    assert.equal(secondBatch.length, 1);
    assert.equal((secondBatch[0]?.metadata as Record<string, unknown> | undefined)?.projectId, "prj-b");

    db.markEnvelopesDone(secondBatch.map((env) => env.id));

    const thirdBatch = db.getPendingEnvelopesForAgent("nex", 10);
    assert.equal(thirdBatch.length, 1);
    assert.equal((thirdBatch[0]?.metadata as Record<string, unknown> | undefined)?.projectId, undefined);
  });
});

test("listProjectChatEnvelopes returns only project-scoped boss/speaker messages", () => {
  withTempDb((db) => {
    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "project-a inbound" },
      metadata: { source: "web", projectId: "prj-a" },
    });
    db.createEnvelope({
      from: "agent:nex",
      to: "channel:web:boss",
      content: { text: "project-a outbound" },
      metadata: { projectId: "prj-a" },
    });
    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:nex",
      fromBoss: true,
      content: { text: "project-b inbound" },
      metadata: { source: "web", projectId: "prj-b" },
    });
    db.createEnvelope({
      from: "channel:web:boss",
      to: "agent:kai",
      fromBoss: true,
      content: { text: "project-a wrong target" },
      metadata: { source: "web", projectId: "prj-a" },
    });

    const rows = db.listProjectChatEnvelopes({
      projectId: "prj-a",
      speakerAddress: "agent:nex",
      bossAddress: "channel:web:boss",
      limit: 50,
    });

    assert.equal(rows.length, 2);
    assert(rows.every((row) => (row.metadata as Record<string, unknown> | undefined)?.projectId === "prj-a"));
    assert.deepEqual(
      rows.map((row) => row.content.text),
      ["project-a outbound", "project-a inbound"]
    );
  });
});

test("project task lifecycle and progress persistence work end-to-end", () => {
  withTempDb((db) => {
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "kai", provider: "codex", role: "leader" });
    db.upsertProject({
      id: "repo.task",
      name: "repo-task",
      root: "/tmp/repo-task",
      speakerAgent: "nex",
    });

    const task = db.createProjectTask({
      projectId: "repo.task",
      title: "Implement project task API",
      priority: "high",
      actor: "channel:web:boss",
      reason: "boss-created",
    });
    assert.equal(task.state, "created");
    assert.equal(task.priority, "high");

    const planning = db.updateProjectTaskState({
      taskId: task.id,
      state: "planning",
      actor: "nex",
      reason: "start-plan",
    });
    assert.equal(planning.state, "planning");

    const dispatched = db.updateProjectTaskState({
      taskId: task.id,
      state: "dispatched",
      actor: "nex",
      assignee: "kai",
      reason: "dispatch-to-leader",
    });
    assert.equal(dispatched.assignee, "kai");

    const progress = db.createTaskProgress({
      taskId: task.id,
      agentName: "kai",
      content: "Implemented handlers",
      todos: ["db done", "web doing"],
    });
    assert.equal(progress.agentName, "kai");
    assert.deepEqual(progress.todos, ["db done", "web doing"]);

    const listed = db.listProjectTasks({ projectId: "repo.task", limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.flowLog.length, 3);
    assert.equal(listed[0]?.state, "dispatched");

    const progressRows = db.listTaskProgress({ taskId: task.id, limit: 10 });
    assert.equal(progressRows.length, 1);
    assert.equal(progressRows[0]?.content, "Implemented handlers");
  });
});
