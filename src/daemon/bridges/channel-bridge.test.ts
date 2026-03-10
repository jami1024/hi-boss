import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  ChannelCommandHandler,
  ChannelMessage,
  ChannelMessageHandler,
  ChatAdapter,
  MessageContent,
  SendMessageOptions,
} from "../../adapters/types.js";
import type { DaemonConfig } from "../daemon.js";
import { HiBossDatabase } from "../db/database.js";
import { MessageRouter } from "../router/message-router.js";
import { ChannelBridge } from "./channel-bridge.js";

class FakeAdapter implements ChatAdapter {
  readonly platform = "fake";
  private messageHandler: ChannelMessageHandler | null = null;
  private commandHandler: ChannelCommandHandler | null = null;
  readonly sentMessages: Array<{ chatId: string; text?: string }> = [];

  async sendMessage(_chatId: string, _content: MessageContent, _options?: SendMessageOptions): Promise<void> {
    this.sentMessages.push({
      chatId: _chatId,
      text: _content.text,
    });
    return;
  }

  onMessage(handler: ChannelMessageHandler): void {
    this.messageHandler = handler;
  }

  onCommand(handler: ChannelCommandHandler): void {
    this.commandHandler = handler;
  }

  async start(): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    return;
  }

  async emitMessage(message: ChannelMessage): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("Message handler is not registered");
    }
    await this.messageHandler(message);
  }
}

function createBridgeConfig(tempDir: string): DaemonConfig {
  return {
    dataDir: tempDir,
    daemonDir: tempDir,
  };
}

async function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-bridge-project-context-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  try {
    await run(db, tempDir);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildMessage(params: {
  id: string;
  chatId: string;
  text: string;
  username?: string;
}): ChannelMessage {
  return {
    id: params.id,
    platform: "fake",
    author: {
      id: params.username ?? "user-1",
      username: params.username,
      displayName: "User One",
    },
    chat: {
      id: params.chatId,
      name: "Test Group",
    },
    content: {
      text: params.text,
    },
    raw: {},
  };
}

test("ChannelBridge injects metadata.projectId for messages from configured main group channel", async () => {
  await withTempDb(async (db, tempDir) => {
    const adapterToken = "fake-token-project";
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.createBinding("nex", "fake", adapterToken);
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
      mainGroupChannel: "channel:fake:group-1",
    });

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FakeAdapter();
    bridge.connect(adapter, adapterToken);

    const envelopePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for envelope")), 3000);
      router.registerAgentHandler("nex", (envelope) => {
        clearTimeout(timeout);
        resolve(envelope.id);
      });
    });

    await adapter.emitMessage(buildMessage({ id: "m-1", chatId: "group-1", text: "hello project context" }));
    const envelopeId = await envelopePromise;
    const envelope = db.getEnvelopeById(envelopeId);
    const metadata = envelope?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.projectId, "repo.a");
  });
});

test("ChannelBridge keeps messages unscoped when channel is not project main group", async () => {
  await withTempDb(async (db, tempDir) => {
    const adapterToken = "fake-token-unscoped";
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.createBinding("nex", "fake", adapterToken);
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
      mainGroupChannel: "channel:fake:group-1",
    });

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FakeAdapter();
    bridge.connect(adapter, adapterToken);

    const envelopePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for envelope")), 3000);
      router.registerAgentHandler("nex", (envelope) => {
        clearTimeout(timeout);
        resolve(envelope.id);
      });
    });

    await adapter.emitMessage(buildMessage({ id: "m-2", chatId: "dm-9", text: "hello unscoped" }));
    const envelopeId = await envelopePromise;
    const envelope = db.getEnvelopeById(envelopeId);
    const metadata = envelope?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.projectId, undefined);
  });
});

test("ChannelBridge uses pinned channel project context for non-main-group chats", async () => {
  await withTempDb(async (db, tempDir) => {
    const adapterToken = "fake-token-pinned";
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.createBinding("nex", "fake", adapterToken);
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
      mainGroupChannel: "channel:fake:group-1",
    });
    db.setConfig("channel_project_context:fake:dm-9:nex", "repo.a");

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FakeAdapter();
    bridge.connect(adapter, adapterToken);

    const envelopePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for envelope")), 3000);
      router.registerAgentHandler("nex", (envelope) => {
        clearTimeout(timeout);
        resolve(envelope.id);
      });
    });

    await adapter.emitMessage(buildMessage({ id: "m-3", chatId: "dm-9", text: "hello pinned" }));
    const envelopeId = await envelopePromise;
    const envelope = db.getEnvelopeById(envelopeId);
    const metadata = envelope?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.projectId, "repo.a");
  });
});

test("ChannelBridge blocks boss direct chat when adapter is bound to leader agent", async () => {
  await withTempDb(async (db, tempDir) => {
    const adapterToken = "fake-token-leader";
    db.setAdapterBossId("fake", "boss");
    db.registerAgent({ name: "lead-1", provider: "codex", role: "leader" });
    db.createBinding("lead-1", "fake", adapterToken);

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FakeAdapter();
    bridge.connect(adapter, adapterToken);

    await adapter.emitMessage({
      id: "m-leader-block",
      platform: "fake",
      author: {
        id: "boss-user",
        username: "boss",
        displayName: "Boss",
      },
      chat: {
        id: "leader-chat",
        name: "Leader Chat",
      },
      content: {
        text: "please do this now",
      },
      raw: {},
    });

    const pending = db.getPendingEnvelopesForAgent("lead-1", 10);
    assert.equal(pending.length, 0);
    assert.equal(adapter.sentMessages.length, 1);
    assert.match(adapter.sentMessages[0]?.text ?? "", /leader-direct-chat-disabled/);
  });
});
