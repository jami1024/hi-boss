import assert from "node:assert/strict";
import fs from "node:fs";
import * as http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FeishuAdapter } from "../../adapters/feishu.adapter.js";
import type { DaemonConfig } from "../daemon.js";
import { HiBossDatabase } from "../db/database.js";
import { MessageRouter } from "../router/message-router.js";
import { ChannelBridge } from "./channel-bridge.js";

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
}

async function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-bridge-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  try {
    await run(db, tempDir);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    throw new Error("Failed to reserve local test port");
  }

  const port = address.port;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

function createBridgeConfig(tempDir: string): DaemonConfig {
  return {
    dataDir: tempDir,
    daemonDir: tempDir,
  };
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });
  return Buffer.concat(chunks).toString("utf8");
}

async function startMockFeishuApiServer(): Promise<{
  baseUrl: string;
  captured: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const captured: CapturedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const requestPath = req.url ?? "/";
    const bodyText = await readRequestBody(req);

    captured.push({
      method,
      path: requestPath,
      headers: req.headers,
      bodyText,
    });

    if (method === "POST" && requestPath === "/open-apis/auth/v3/tenant_access_token/internal") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: 0, tenant_access_token: "tenant_token_bridge", expire: 7200 }));
      return;
    }

    if (method === "POST" && requestPath === "/open-apis/im/v1/messages?receive_id_type=chat_id") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: 0, data: { message_id: "om_sent_bridge_1" } }));
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ code: 404, msg: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start mock Feishu API server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    captured,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

test("ChannelBridge routes Feishu inbound webhook to agent envelope", async () => {
  await withTempDb(async (db, tempDir) => {
    const webhookPort = await reservePort();
    const adapterToken = JSON.stringify({
      app_id: "app_bridge_inbound",
      app_secret: "secret_bridge_inbound",
      verification_token: "verify_bridge_1",
      webhook_host: "127.0.0.1",
      webhook_port: String(webhookPort),
      webhook_path: "/feishu/events",
    });

    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", adapterToken);
    db.setAdapterBossId("feishu", "boss_user_1");

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FeishuAdapter(adapterToken);
    bridge.connect(adapter, adapterToken);

    const envelopePromise = new Promise<{
      id: string;
      from: string;
      to: string;
      fromBoss: boolean;
      text?: string;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for routed envelope"));
      }, 4000);

      router.registerAgentHandler("nex", (envelope) => {
        clearTimeout(timeout);
        resolve({
          id: envelope.id,
          from: envelope.from,
          to: envelope.to,
          fromBoss: envelope.fromBoss,
          text: envelope.content.text,
        });
      });
    });

    await adapter.start();
    try {
      const response = await fetch(`http://127.0.0.1:${webhookPort}/feishu/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: "2.0",
          header: {
            event_type: "im.message.receive_v1",
            token: "verify_bridge_1",
          },
          event: {
            sender: {
              sender_id: {
                open_id: "ou_user_bridge",
                user_id: "boss_user_1",
              },
            },
            message: {
              message_id: "om_bridge_1",
              chat_id: "oc_chat_bridge_1",
              message_type: "text",
              content: JSON.stringify({ text: "hello bridge" }),
            },
          },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { code: 0, msg: "success" });

      const routed = await envelopePromise;
      assert.equal(routed.from, "channel:feishu:oc_chat_bridge_1");
      assert.equal(routed.to, "agent:nex");
      assert.equal(routed.fromBoss, true);
      assert.equal(routed.text, "hello bridge");

      const persisted = db.getEnvelopeById(routed.id);
      assert.ok(persisted);
      assert.equal(persisted?.fromBoss, true);

      const metadata = persisted?.metadata as Record<string, unknown> | undefined;
      assert.equal(metadata?.platform, "feishu");
      assert.equal(metadata?.channelMessageId, "om_bridge_1");
    } finally {
      await adapter.stop();
    }
  });
});

test("ChannelBridge requires confirmation for boss destructive messages", async () => {
  await withTempDb(async (db, tempDir) => {
    const api = await startMockFeishuApiServer();
    const webhookPort = await reservePort();
    const adapterToken = JSON.stringify({
      app_id: "app_bridge_confirm_gate",
      app_secret: "secret_bridge_confirm_gate",
      verification_token: "verify_bridge_confirm_1",
      webhook_host: "127.0.0.1",
      webhook_port: String(webhookPort),
      webhook_path: "/feishu/events",
      api_base: `${api.baseUrl}/open-apis`,
    });

    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", adapterToken);
    db.setAdapterBossId("feishu", "boss_user_1");

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FeishuAdapter(adapterToken);
    bridge.connect(adapter, adapterToken);

    await adapter.start();
    try {
      const response = await fetch(`http://127.0.0.1:${webhookPort}/feishu/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: "2.0",
          header: {
            event_type: "im.message.receive_v1",
            token: "verify_bridge_confirm_1",
          },
          event: {
            sender: {
              sender_id: {
                open_id: "ou_user_bridge_confirm",
                user_id: "boss_user_1",
              },
            },
            message: {
              message_id: "om_bridge_confirm_1",
              chat_id: "oc_chat_confirm_1",
              message_type: "text",
              content: JSON.stringify({ text: "删除这个目录 /tmp/test" }),
            },
          },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { code: 0, msg: "success" });

      const doneEnvelopes = db.listEnvelopesByRoute({
        from: "channel:feishu:oc_chat_confirm_1",
        to: "agent:nex",
        status: "done",
        limit: 10,
      });
      const pendingEnvelopes = db.listEnvelopesByRoute({
        from: "channel:feishu:oc_chat_confirm_1",
        to: "agent:nex",
        status: "pending",
        limit: 10,
      });
      assert.equal(doneEnvelopes.length, 0);
      assert.equal(pendingEnvelopes.length, 0);

      assert.equal(api.captured.length, 2);
      assert.equal(api.captured[1]?.path, "/open-apis/im/v1/messages?receive_id_type=chat_id");
      const sendPayload = JSON.parse(api.captured[1]!.bodyText) as Record<string, unknown>;
      assert.equal(sendPayload.receive_id, "oc_chat_confirm_1");
      assert.equal(sendPayload.msg_type, "text");
      assert.ok(typeof sendPayload.content === "string");
      assert.ok((sendPayload.content as string).includes("确认执行"));
    } finally {
      await adapter.stop();
      await api.close();
    }
  });
});

test("ChannelBridge routes confirmed destructive boss message after confirmation prefix", async () => {
  await withTempDb(async (db, tempDir) => {
    const api = await startMockFeishuApiServer();
    const webhookPort = await reservePort();
    const adapterToken = JSON.stringify({
      app_id: "app_bridge_confirm_route",
      app_secret: "secret_bridge_confirm_route",
      verification_token: "verify_bridge_confirm_2",
      webhook_host: "127.0.0.1",
      webhook_port: String(webhookPort),
      webhook_path: "/feishu/events",
      api_base: `${api.baseUrl}/open-apis`,
    });

    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", adapterToken);
    db.setAdapterBossId("feishu", "boss_user_1");

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FeishuAdapter(adapterToken);
    bridge.connect(adapter, adapterToken);

    const envelopePromise = new Promise<{ text?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for confirmed destructive envelope"));
      }, 4000);

      router.registerAgentHandler("nex", (envelope) => {
        clearTimeout(timeout);
        resolve({ text: envelope.content.text });
      });
    });

    await adapter.start();
    try {
      const response = await fetch(`http://127.0.0.1:${webhookPort}/feishu/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: "2.0",
          header: {
            event_type: "im.message.receive_v1",
            token: "verify_bridge_confirm_2",
          },
          event: {
            sender: {
              sender_id: {
                open_id: "ou_user_bridge_confirm",
                user_id: "boss_user_1",
              },
            },
            message: {
              message_id: "om_bridge_confirm_2",
              chat_id: "oc_chat_confirm_2",
              message_type: "text",
              content: JSON.stringify({ text: "确认执行：删除这个目录 /tmp/test" }),
            },
          },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { code: 0, msg: "success" });

      const routed = await envelopePromise;
      assert.equal(routed.text, "删除这个目录 /tmp/test");
      assert.equal(api.captured.length, 0);
    } finally {
      await adapter.stop();
      await api.close();
    }
  });
});

test("MessageRouter delivers Feishu outbound channel message via bound adapter", async () => {
  await withTempDb(async (db, tempDir) => {
    const api = await startMockFeishuApiServer();
    const adapterToken = JSON.stringify({
      app_id: "app_bridge_outbound",
      app_secret: "secret_bridge_outbound",
      api_base: `${api.baseUrl}/open-apis`,
    });

    db.registerAgent({
      name: "nex",
      provider: "codex",
      role: "speaker",
    });
    db.createBinding("nex", "feishu", adapterToken);

    const router = new MessageRouter(db);
    const bridge = new ChannelBridge(router, db, createBridgeConfig(tempDir));
    const adapter = new FeishuAdapter(adapterToken);
    bridge.connect(adapter, adapterToken);

    try {
      const envelope = await router.routeEnvelope({
        from: "agent:nex",
        to: "channel:feishu:oc_chat_outbound_1",
        fromBoss: false,
        content: {
          text: "outbound through router",
        },
      });

      const persisted = db.getEnvelopeById(envelope.id);
      assert.ok(persisted);
      assert.equal(persisted?.status, "done");

      assert.equal(api.captured.length, 2);
      assert.equal(api.captured[0]?.path, "/open-apis/auth/v3/tenant_access_token/internal");
      assert.equal(api.captured[1]?.path, "/open-apis/im/v1/messages?receive_id_type=chat_id");
      assert.equal(api.captured[1]?.headers.authorization, "Bearer tenant_token_bridge");

      const sendPayload = JSON.parse(api.captured[1]!.bodyText) as Record<string, unknown>;
      assert.equal(sendPayload.receive_id, "oc_chat_outbound_1");
      assert.equal(sendPayload.msg_type, "text");
    } finally {
      await adapter.stop();
      await api.close();
    }
  });
});
