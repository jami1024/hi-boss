import assert from "node:assert/strict";
import test from "node:test";
import type { Envelope } from "../envelope/types.js";
import { buildRunFailureNotificationEnvelopes } from "./executor.js";

function createEnvelope(input: {
  id: string;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
}): Envelope {
  return {
    id: input.id,
    from: input.from,
    to: input.to,
    fromBoss: false,
    content: { text: "test" },
    status: "done",
    createdAt: 0,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

test("buildRunFailureNotificationEnvelopes keeps reply chain and project context", () => {
  const notices = buildRunFailureNotificationEnvelopes({
    agentName: "worker-agent",
    runId: "run-123",
    error: "codex exited with code 1: http 429 Too Many Requests",
    triggeringEnvelopes: [
      createEnvelope({
        id: "env-1",
        from: "agent:lead-agent",
        to: "agent:worker-agent",
        metadata: {
          projectId: "prj-1",
          taskId: "task-9",
        },
      }),
    ],
  });

  assert.equal(notices.length, 1);
  const notice = notices[0];
  assert.equal(notice.from, "agent:worker-agent");
  assert.equal(notice.to, "agent:lead-agent");
  assert.equal(notice.fromBoss, false);
  assert.equal(notice.metadata?.source, "agent-run-failure");
  assert.equal(notice.metadata?.replyToEnvelopeId, "env-1");
  assert.equal(notice.metadata?.projectId, "prj-1");
  assert.equal(notice.metadata?.taskId, "task-9");
  assert.match(notice.content.text ?? "", /Agent run failed while processing your message\./);
  assert.match(notice.content.text ?? "", /run-id: run-123/);
});

test("buildRunFailureNotificationEnvelopes can notify channel sender", () => {
  const notices = buildRunFailureNotificationEnvelopes({
    agentName: "worker-agent",
    runId: "run-456",
    error: "provider timeout",
    triggeringEnvelopes: [
      createEnvelope({
        id: "env-2",
        from: "channel:web:boss",
        to: "agent:worker-agent",
      }),
    ],
  });

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.to, "channel:web:boss");
  assert.equal(notices[0]?.metadata?.replyToEnvelopeId, "env-2");
});

test("buildRunFailureNotificationEnvelopes skips self-originated envelopes", () => {
  const notices = buildRunFailureNotificationEnvelopes({
    agentName: "worker-agent",
    runId: "run-789",
    error: "something failed",
    triggeringEnvelopes: [
      createEnvelope({
        id: "env-self",
        from: "agent:worker-agent",
        to: "agent:worker-agent",
      }),
    ],
  });

  assert.equal(notices.length, 0);
});

test("buildRunFailureNotificationEnvelopes truncates very long errors", () => {
  const longError = `prefix ${"x".repeat(800)}`;
  const notices = buildRunFailureNotificationEnvelopes({
    agentName: "worker-agent",
    runId: "run-long",
    error: longError,
    triggeringEnvelopes: [
      createEnvelope({
        id: "env-long",
        from: "agent:lead-agent",
        to: "agent:worker-agent",
      }),
    ],
  });

  const text = notices[0]?.content.text ?? "";
  assert.match(text, /error: prefix/);
  assert.match(text, /\.\.\.$/);
  assert.ok(text.length < 500);
});
