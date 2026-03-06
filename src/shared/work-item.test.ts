import assert from "node:assert/strict";
import test from "node:test";
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
} from "./work-item.js";

test("normalizeWorkItemId accepts lowercase orchestration ids", () => {
  assert.equal(normalizeWorkItemId("req-2026.03.05-alpha"), "req-2026.03.05-alpha");
  assert.equal(normalizeWorkItemId("  req:ui-review  "), "req:ui-review");
});

test("normalizeWorkItemId rejects invalid ids", () => {
  assert.equal(normalizeWorkItemId(""), null);
  assert.equal(normalizeWorkItemId("bad*id"), null);
  assert.equal(normalizeWorkItemId("bad space"), null);
});

test("normalizeWorkItemTitle validates title constraints", () => {
  assert.equal(normalizeWorkItemTitle("  Improve onboarding flow "), "Improve onboarding flow");
  assert.equal(normalizeWorkItemTitle(""), null);
  assert.equal(normalizeWorkItemTitle("x".repeat(201)), null);
});

test("extractWorkItemEnvelopeFields tolerates malformed metadata", () => {
  assert.deepEqual(extractWorkItemEnvelopeFields(null), {});
  assert.deepEqual(
    extractWorkItemEnvelopeFields({
      workItemId: "REQ INVALID",
      workItemState: "unknown",
      workItemTitle: "",
    }),
    {}
  );

  assert.deepEqual(
    extractWorkItemEnvelopeFields({
      workItemId: "req-123",
      workItemState: "in-progress",
      workItemTitle: "Implement API endpoint",
    }),
    {
      workItemId: "req-123",
      workItemState: "in-progress",
      workItemTitle: "Implement API endpoint",
    }
  );
});

test("mergeWorkItemEnvelopeFields appends work item keys", () => {
  const merged = mergeWorkItemEnvelopeFields({
    metadata: { replyToEnvelopeId: "abc12345" },
    fields: {
      workItemId: "req-44",
      workItemState: "triaged",
      workItemTitle: "Refactor auth module",
    },
  });

  assert.deepEqual(merged, {
    replyToEnvelopeId: "abc12345",
    workItemId: "req-44",
    workItemState: "triaged",
    workItemTitle: "Refactor auth module",
  });
});

test("isWorkItemState validates allowed lifecycle values", () => {
  assert.equal(isWorkItemState("new"), true);
  assert.equal(isWorkItemState("done"), true);
  assert.equal(isWorkItemState("invalid"), false);
});

test("canStartWorkItemWithState enforces valid initial states", () => {
  assert.equal(canStartWorkItemWithState("new"), true);
  assert.equal(canStartWorkItemWithState("in-progress"), true);
  assert.equal(canStartWorkItemWithState("done"), false);
  assert.equal(canStartWorkItemWithState("archived"), false);
});

test("canTransitionWorkItemState enforces lifecycle transitions", () => {
  assert.equal(canTransitionWorkItemState("new", "triaged"), true);
  assert.equal(canTransitionWorkItemState("triaged", "done"), false);
  assert.equal(canTransitionWorkItemState("done", "in-progress"), true);
  assert.equal(canTransitionWorkItemState("archived", "in-progress"), false);
  assert.equal(canTransitionWorkItemState("in-progress", "in-progress"), true);
});

test("canRoleSetWorkItemState restricts done approval to leader", () => {
  assert.equal(canRoleSetWorkItemState("leader", "done"), true);
  assert.equal(canRoleSetWorkItemState("speaker", "done"), false);
  assert.equal(canRoleSetWorkItemState("speaker", "blocked"), true);
});

test("resolveWorkItemChannelPolicy allows first channel and known channels", () => {
  assert.deepEqual(
    resolveWorkItemChannelPolicy({
      senderRole: "speaker",
      destinationChannelAddress: "channel:feishu:oc_main",
      knownChannelAddresses: [],
      strictAllowlist: false,
    }),
    {
      allowed: true,
      extendsAllowlist: true,
    }
  );

  assert.deepEqual(
    resolveWorkItemChannelPolicy({
      senderRole: "speaker",
      destinationChannelAddress: "channel:feishu:oc_main",
      knownChannelAddresses: ["channel:feishu:oc_main"],
      strictAllowlist: false,
    }),
    {
      allowed: true,
      extendsAllowlist: false,
    }
  );
});

test("resolveWorkItemChannelPolicy blocks speaker cross-channel but allows leader expansion", () => {
  assert.deepEqual(
    resolveWorkItemChannelPolicy({
      senderRole: "speaker",
      destinationChannelAddress: "channel:feishu:oc_requirements",
      knownChannelAddresses: ["channel:feishu:oc_main"],
      strictAllowlist: false,
    }),
    {
      allowed: false,
      extendsAllowlist: false,
    }
  );

  assert.deepEqual(
    resolveWorkItemChannelPolicy({
      senderRole: "leader",
      destinationChannelAddress: "channel:feishu:oc_requirements",
      knownChannelAddresses: ["channel:feishu:oc_main"],
      strictAllowlist: false,
    }),
    {
      allowed: true,
      extendsAllowlist: true,
    }
  );
});

test("resolveWorkItemChannelPolicy enforces strict allowlist for non-leader", () => {
  assert.deepEqual(
    resolveWorkItemChannelPolicy({
      senderRole: "speaker",
      destinationChannelAddress: "channel:feishu:oc_main",
      knownChannelAddresses: [],
      strictAllowlist: true,
    }),
    {
      allowed: false,
      extendsAllowlist: false,
    }
  );

  assert.deepEqual(
    resolveWorkItemChannelPolicy({
      senderRole: "leader",
      destinationChannelAddress: "channel:feishu:oc_main",
      knownChannelAddresses: [],
      strictAllowlist: true,
    }),
    {
      allowed: true,
      extendsAllowlist: true,
    }
  );
});
