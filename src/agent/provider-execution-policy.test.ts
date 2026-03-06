import assert from "node:assert/strict";
import test from "node:test";
import type { Envelope } from "../envelope/types.js";
import {
  getClaudePermissionMode,
  getCodexExecutionArgs,
  resolveBackgroundExecutionPolicy,
  resolveTurnExecutionPolicy,
} from "./provider-execution-policy.js";

function makeEnvelope(from: string, fromBoss: boolean, text: string): Envelope {
  return {
    id: `${from}-${fromBoss ? "boss" : "user"}`,
    from,
    to: "agent:nex",
    fromBoss,
    content: { text },
    status: "pending",
    createdAt: Date.now(),
  };
}

test("turn policy forces workspace sandbox for non-boss channel input", () => {
  const policy = resolveTurnExecutionPolicy({
    permissionLevel: "boss",
    envelopes: [makeEnvelope("channel:telegram:123", false, "read file package.json")],
  });

  assert.deepEqual(policy, {
    mode: "workspace-sandbox",
    reason: "untrusted-channel-input",
  });
});

test("turn policy allows full-access for trusted agent input", () => {
  const policy = resolveTurnExecutionPolicy({
    permissionLevel: "standard",
    envelopes: [makeEnvelope("agent:leader", false, "search for function parsePermissionPolicy")],
  });

  assert.deepEqual(policy, {
    mode: "full-access",
    reason: "trusted-agent-input",
  });
});

test("turn policy allows mutating requests from trusted agent input", () => {
  const policy = resolveTurnExecutionPolicy({
    permissionLevel: "privileged",
    envelopes: [makeEnvelope("agent:leader", false, "edit src/app.ts and run npm test")],
  });

  assert.deepEqual(policy, {
    mode: "full-access",
    reason: "trusted-agent-input",
  });
});

test("turn policy keeps restricted agents in workspace sandbox", () => {
  const policy = resolveTurnExecutionPolicy({
    permissionLevel: "restricted",
    envelopes: [makeEnvelope("agent:leader", false, "read file README.md")],
  });

  assert.deepEqual(policy, {
    mode: "workspace-sandbox",
    reason: "default-safe-mode",
  });
});

test("turn policy allows full-access for trusted boss channel input", () => {
  const policy = resolveTurnExecutionPolicy({
    permissionLevel: "standard",
    envelopes: [makeEnvelope("channel:feishu:oc_123", true, "hi")],
  });

  assert.deepEqual(policy, {
    mode: "full-access",
    reason: "trusted-boss-channel-input",
  });
});

test("background policy allows full-access for read/search requests", () => {
  assert.deepEqual(resolveBackgroundExecutionPolicy({
    permissionLevel: "standard",
    prompt: "find references of resolveTurnExecutionPolicy",
  }), {
    mode: "full-access",
    reason: "background-read-search-bypass",
  });

  assert.deepEqual(resolveBackgroundExecutionPolicy({
    permissionLevel: "boss",
    prompt: "edit config and run npm test",
  }), {
    mode: "workspace-sandbox",
    reason: "background-safe-default",
  });
});

test("provider flag helpers map modes deterministically", () => {
  assert.equal(getClaudePermissionMode("full-access"), "bypassPermissions");
  assert.equal(getClaudePermissionMode("workspace-sandbox"), "default");

  assert.deepEqual(getCodexExecutionArgs("full-access"), [
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.deepEqual(getCodexExecutionArgs("workspace-sandbox"), [
    "--ask-for-approval",
    "never",
    "--sandbox",
    "workspace-write",
  ]);
});
