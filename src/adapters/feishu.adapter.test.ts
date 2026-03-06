import assert from "node:assert/strict";
import * as http from "node:http";
import test from "node:test";
import { FeishuAdapter } from "./feishu.adapter.js";

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
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
    throw new Error("Failed to reserve test port");
  }

  const port = address.port;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
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
    const path = req.url ?? "/";
    const bodyText = await readRequestBody(req);

    captured.push({
      method,
      path,
      headers: req.headers,
      bodyText,
    });

    if (method === "POST" && path === "/open-apis/auth/v3/tenant_access_token/internal") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: 0, tenant_access_token: "tenant_token_1", expire: 7200 }));
      return;
    }

    if (method === "POST" && path === "/open-apis/im/v1/messages?receive_id_type=chat_id") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: 0, data: { message_id: "om_message_sent_1" } }));
      return;
    }

    if (method === "POST" && path === "/open-apis/im/v1/messages/om_parent_1/reply") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: 0, data: { message_id: "om_message_sent_2" } }));
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

test("FeishuAdapter webhook supports challenge and message dispatch", async () => {
  const webhookPort = await reservePort();
  const adapter = new FeishuAdapter(
    JSON.stringify({
      app_id: "app_for_webhook",
      app_secret: "secret_for_webhook",
      verification_token: "verify_token_1",
      webhook_host: "127.0.0.1",
      webhook_port: String(webhookPort),
      webhook_path: "/feishu/events",
    })
  );

  const received: Array<{ id: string; chatId: string; text?: string; authorId: string }> = [];
  adapter.onMessage((message) => {
    received.push({
      id: message.id,
      chatId: message.chat.id,
      text: message.content.text,
      authorId: message.author.id,
    });
  });

  await adapter.start();
  try {
    const challengeResp = await fetch(`http://127.0.0.1:${webhookPort}/feishu/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "url_verification",
        challenge: "challenge_1",
        token: "verify_token_1",
      }),
    });
    assert.equal(challengeResp.status, 200);
    assert.deepEqual(await challengeResp.json(), { challenge: "challenge_1" });

    const eventResp = await fetch(`http://127.0.0.1:${webhookPort}/feishu/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: "2.0",
        header: {
          event_type: "im.message.receive_v1",
          token: "verify_token_1",
        },
        event: {
          sender: {
            sender_id: {
              open_id: "ou_user_1",
              user_id: "user_1",
            },
          },
          message: {
            message_id: "om_message_1",
            chat_id: "oc_chat_1",
            message_type: "text",
            content: JSON.stringify({ text: "hello from webhook" }),
          },
        },
      }),
    });
    assert.equal(eventResp.status, 200);
    assert.deepEqual(await eventResp.json(), { code: 0, msg: "success" });

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      id: "om_message_1",
      chatId: "oc_chat_1",
      text: "hello from webhook",
      authorId: "ou_user_1",
    });

    const forbiddenResp = await fetch(`http://127.0.0.1:${webhookPort}/feishu/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "url_verification",
        challenge: "challenge_2",
        token: "wrong_token",
      }),
    });
    assert.equal(forbiddenResp.status, 403);
  } finally {
    await adapter.stop();
  }
});

test("FeishuAdapter sendMessage performs auth and send/reply calls", async () => {
  const api = await startMockFeishuApiServer();
  const adapter = new FeishuAdapter(
    JSON.stringify({
      app_id: "app_for_send",
      app_secret: "secret_for_send",
      api_base: `${api.baseUrl}/open-apis`,
    })
  );

  try {
    await adapter.sendMessage("oc_chat_1", { text: "plain message" });
    await adapter.sendMessage("oc_chat_1", { text: "reply message" }, { replyToMessageId: "om_parent_1" });

    assert.equal(api.captured.length, 3);

    const authReq = api.captured[0]!;
    assert.equal(authReq.method, "POST");
    assert.equal(authReq.path, "/open-apis/auth/v3/tenant_access_token/internal");
    assert.deepEqual(JSON.parse(authReq.bodyText), {
      app_id: "app_for_send",
      app_secret: "secret_for_send",
    });

    const sendReq = api.captured[1]!;
    assert.equal(sendReq.method, "POST");
    assert.equal(sendReq.path, "/open-apis/im/v1/messages?receive_id_type=chat_id");
    assert.equal(sendReq.headers.authorization, "Bearer tenant_token_1");
    assert.deepEqual(JSON.parse(sendReq.bodyText), {
      receive_id: "oc_chat_1",
      content: JSON.stringify({ text: "plain message" }),
      msg_type: "text",
    });

    const replyReq = api.captured[2]!;
    assert.equal(replyReq.method, "POST");
    assert.equal(replyReq.path, "/open-apis/im/v1/messages/om_parent_1/reply");
    assert.equal(replyReq.headers.authorization, "Bearer tenant_token_1");
    assert.deepEqual(JSON.parse(replyReq.bodyText), {
      content: JSON.stringify({ text: "reply message" }),
      msg_type: "text",
    });
  } finally {
    await api.close();
  }
});
