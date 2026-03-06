import * as http from "node:http";
import type {
  ChannelCommandHandler,
  ChannelMessageHandler,
  ChatAdapter,
  MessageContent,
  SendMessageOptions,
} from "./types.js";
import { parseFeishuIncomingPayload } from "./feishu/incoming.js";
import { sendFeishuMessage } from "./feishu/outgoing.js";
import { parseFeishuAdapterToken } from "./feishu/token.js";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

function writeJson(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

export class FeishuAdapter implements ChatAdapter {
  readonly platform = "feishu";

  private readonly config;
  private readonly tokenState: { accessToken?: string; expiresAtMs?: number } = {};
  private readonly handlers: ChannelMessageHandler[] = [];
  private readonly commandHandlers: ChannelCommandHandler[] = [];

  private server: http.Server | null = null;
  private started = false;

  constructor(token: string) {
    this.config = parseFeishuAdapterToken(token);
  }

  onMessage(handler: ChannelMessageHandler): void {
    this.handlers.push(handler);
  }

  onCommand(handler: ChannelCommandHandler): void {
    this.commandHandlers.push(handler);
  }

  async sendMessage(chatId: string, content: MessageContent, options: SendMessageOptions = {}): Promise<void> {
    await sendFeishuMessage({
      config: this.config,
      tokenState: this.tokenState,
      chatId,
      content,
      replyToMessageId: options.replyToMessageId,
    });
  }

  private async dispatchIncomingMessage(message: Parameters<ChannelMessageHandler>[0]): Promise<void> {
    for (const handler of this.handlers) {
      await handler(message);
    }
  }

  private async handleWebhookRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      writeJson(res, 404, { error: "Not found" });
      return;
    }

    const requestPath = req.url ? req.url.split("?")[0] : "";
    if (requestPath !== this.config.webhookPath) {
      writeJson(res, 404, { error: "Not found" });
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        req.on("data", (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > MAX_WEBHOOK_BODY_BYTES) {
            reject(new Error("Webhook payload too large"));
            return;
          }
          chunks.push(buf);
        });
        req.on("end", () => resolve());
        req.on("error", reject);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Webhook read failed";
      const statusCode = message.includes("too large") ? 413 : 400;
      writeJson(res, statusCode, { error: message });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      writeJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    const parsed = parseFeishuIncomingPayload(payload);
    if (parsed.kind === "error") {
      writeJson(res, 400, { error: parsed.message });
      return;
    }

    if (this.config.verificationToken) {
      const token = parsed.kind === "challenge" || parsed.kind === "message" ? parsed.token : undefined;
      if (!token || token !== this.config.verificationToken) {
        writeJson(res, 403, { error: "Verification token check failed" });
        return;
      }
    }

    if (parsed.kind === "challenge") {
      writeJson(res, 200, { challenge: parsed.challenge });
      return;
    }

    if (parsed.kind === "ignore") {
      writeJson(res, 200, { code: 0, msg: "ignored" });
      return;
    }

    try {
      await this.dispatchIncomingMessage(parsed.message);
      writeJson(res, 200, { code: 0, msg: "success" });
    } catch (err) {
      writeJson(res, 500, { error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (!this.config.webhookEnabled) {
      console.log("[feishu] Adapter started (outgoing-only; set verificationToken to enable inbound webhook)");
      return;
    }

    this.server = http.createServer((req, res) => {
      void this.handleWebhookRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once("error", reject);
      server.listen(this.config.webhookPort, this.config.webhookHost, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    console.log(
      `[feishu] Webhook listening on http://${this.config.webhookHost}:${this.config.webhookPort}${this.config.webhookPath}`
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (!this.server) {
      console.log("[feishu] Adapter stopped");
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    console.log("[feishu] Adapter stopped");
  }
}
