import assert from "node:assert/strict";
import test from "node:test";
import type { ChatAdapter, ChannelMessageHandler, MessageContent, SendMessageOptions } from "../../adapters/types.js";
import type { HiBossDatabase } from "../db/database.js";
import { formatTelegramMessageIdCompact } from "../../shared/telegram-message-id.js";
import type { Envelope, EnvelopeStatus } from "../../envelope/types.js";
import { MessageRouter } from "./message-router.js";

function makeEnvelope(params: {
  id: string;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
}): Envelope {
  return {
    id: params.id,
    from: params.from,
    to: params.to,
    fromBoss: false,
    content: { text: "hello" },
    status: "pending",
    createdAt: Date.now(),
    metadata: params.metadata,
  };
}

class FakeDb {
  private readonly envelopes = new Map<string, Envelope>();

  public readonly statusUpdates: Array<{ id: string; status: EnvelopeStatus }> = [];

  constructor(
    private readonly adapterType: string = "telegram",
    private readonly adapterToken: string = "test-token"
  ) {}

  addEnvelope(envelope: Envelope): void {
    this.envelopes.set(envelope.id, envelope);
  }

  getAgentBindingByType(_agentName: string, adapterType: string): { adapterToken: string } | undefined {
    if (adapterType !== this.adapterType) return undefined;
    return { adapterToken: this.adapterToken };
  }

  getEnvelopeById(id: string): Envelope | undefined {
    return this.envelopes.get(id);
  }

  updateEnvelopeStatus(id: string, status: EnvelopeStatus): void {
    this.statusUpdates.push({ id, status });
  }

  updateEnvelopeMetadata(): void {}
}

class FakeTelegramAdapter implements ChatAdapter {
  readonly platform = "telegram";

  readonly calls: Array<{ chatId: string; options?: SendMessageOptions }> = [];

  async sendMessage(_chatId: string, _content: MessageContent, options?: SendMessageOptions): Promise<void> {
    this.calls.push({ chatId: _chatId, options });
  }

  onMessage(_handler: ChannelMessageHandler): void {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {}
}

test("channel delivery uses replyToEnvelopeId for same-chat telegram quoting", async () => {
  const db = new FakeDb("telegram", "token-1");
  const adapter = new FakeTelegramAdapter();
  const router = new MessageRouter(db as unknown as HiBossDatabase);
  router.registerAdapter(adapter, "token-1");

  const parent = makeEnvelope({
    id: "parent-1",
    from: "channel:telegram:chat-1",
    to: "agent:nex",
    metadata: { channelMessageId: "2147483647" },
  });
  db.addEnvelope(parent);

  const outgoing = makeEnvelope({
    id: "child-1",
    from: "agent:nex",
    to: "channel:telegram:chat-1",
    metadata: { replyToEnvelopeId: parent.id },
  });

  await router.deliverEnvelope(outgoing);

  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.chatId, "chat-1");
  assert.equal(
    adapter.calls[0]?.options?.replyToMessageId,
    formatTelegramMessageIdCompact("2147483647")
  );
  assert.deepEqual(db.statusUpdates, [{ id: "child-1", status: "done" }]);
});

test("channel delivery ignores legacy metadata.replyToMessageId and still sends", async () => {
  const db = new FakeDb("telegram", "token-1");
  const adapter = new FakeTelegramAdapter();
  const router = new MessageRouter(db as unknown as HiBossDatabase);
  router.registerAdapter(adapter, "token-1");

  const outgoing = makeEnvelope({
    id: "child-legacy",
    from: "agent:nex",
    to: "channel:telegram:chat-1",
    metadata: { replyToMessageId: "tg:abc123" },
  });

  await router.deliverEnvelope(outgoing);

  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.chatId, "chat-1");
  assert.equal(adapter.calls[0]?.options?.replyToMessageId, undefined);
  assert.deepEqual(db.statusUpdates, [{ id: "child-legacy", status: "done" }]);
});

for (const scenario of [
  {
    name: "cross-chat references",
    parentFrom: "channel:telegram:chat-2",
  },
  {
    name: "cross-adapter references",
    parentFrom: "channel:discord:chat-1",
  },
]) {
  test(`channel delivery ignores replyToEnvelopeId for ${scenario.name}`, async () => {
    const db = new FakeDb("telegram", "token-1");
    const adapter = new FakeTelegramAdapter();
    const router = new MessageRouter(db as unknown as HiBossDatabase);
    router.registerAdapter(adapter, "token-1");

    const parent = makeEnvelope({
      id: `parent-${scenario.name}`,
      from: scenario.parentFrom,
      to: "agent:nex",
      metadata: { channelMessageId: "zik0zj" },
    });
    db.addEnvelope(parent);

    const outgoing = makeEnvelope({
      id: `child-${scenario.name}`,
      from: "agent:nex",
      to: "channel:telegram:chat-1",
      metadata: { replyToEnvelopeId: parent.id },
    });

    await router.deliverEnvelope(outgoing);

    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0]?.chatId, "chat-1");
    assert.equal(adapter.calls[0]?.options?.replyToMessageId, undefined);
    assert.deepEqual(db.statusUpdates, [{ id: outgoing.id, status: "done" }]);
  });
}

test("channel:web:boss delivery succeeds without loaded adapter", async () => {
  const db = new FakeDb("web", "web-builtin");
  const done: string[] = [];

  const router = new MessageRouter(db as unknown as HiBossDatabase, {
    onEnvelopeDone: async (env) => {
      done.push(env.id);
    },
  });

  const outgoing = makeEnvelope({
    id: "web-child-1",
    from: "agent:lead-agent",
    to: "channel:web:boss",
  });

  await router.deliverEnvelope(outgoing);

  assert.deepEqual(db.statusUpdates, [{ id: "web-child-1", status: "done" }]);
  assert.deepEqual(done, ["web-child-1"]);
});

test("channel:web:<non-boss> still fails when no web adapter is loaded", async () => {
  const db = new FakeDb("web", "web-builtin");
  const done: string[] = [];

  const router = new MessageRouter(db as unknown as HiBossDatabase, {
    onEnvelopeDone: async (env) => {
      done.push(env.id);
    },
  });

  const outgoing = makeEnvelope({
    id: "web-child-2",
    from: "agent:lead-agent",
    to: "channel:web:someone-else",
  });

  await assert.rejects(() => router.deliverEnvelope(outgoing), /adapter token is not loaded/);
  assert.deepEqual(db.statusUpdates, [{ id: "web-child-2", status: "done" }]);
  assert.deepEqual(done, []);
});
