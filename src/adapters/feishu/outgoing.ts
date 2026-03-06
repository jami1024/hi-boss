import type { Attachment, MessageContent } from "../types.js";
import type { FeishuAdapterTokenConfig } from "./token.js";

interface FeishuTokenState {
  accessToken?: string;
  expiresAtMs?: number;
}

interface FeishuApiResult {
  code: number;
  msg?: string;
  [key: string]: unknown;
}

const FEISHU_MAX_TEXT_CHARS = 3000;

function splitTextForFeishu(text: string): string[] {
  if (text.length <= FEISHU_MAX_TEXT_CHARS) return [text];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = Math.min(cursor + FEISHU_MAX_TEXT_CHARS, text.length);
    chunks.push(text.slice(cursor, next));
    cursor = next;
  }
  return chunks;
}

function renderAttachmentLines(attachments: Attachment[]): string {
  return attachments.map((att) => `- ${att.source}`).join("\n");
}

function buildFeishuText(content: MessageContent): string {
  const text = typeof content.text === "string" ? content.text.trim() : "";
  const attachments = Array.isArray(content.attachments) ? content.attachments : [];
  if (attachments.length === 0) return text;

  const attachmentBlock = `attachments:\n${renderAttachmentLines(attachments)}`;
  if (!text) return attachmentBlock;
  return `${text}\n\n${attachmentBlock}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<FeishuApiResult> {
  const response = await fetch(url, init);
  const text = await response.text();

  let parsed: FeishuApiResult;
  try {
    parsed = JSON.parse(text) as FeishuApiResult;
  } catch {
    throw new Error(`Feishu API request failed with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Feishu API request failed with HTTP ${response.status}: ${parsed.msg ?? "unknown"}`);
  }
  return parsed;
}

async function getTenantAccessToken(
  config: FeishuAdapterTokenConfig,
  state: FeishuTokenState
): Promise<string> {
  if (
    typeof state.accessToken === "string" &&
    state.accessToken &&
    typeof state.expiresAtMs === "number" &&
    state.expiresAtMs > Date.now() + 60_000
  ) {
    return state.accessToken;
  }

  const data = await fetchJson(`${config.apiBase}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });

  const accessToken = typeof data.tenant_access_token === "string" ? data.tenant_access_token : "";
  const expireSec = typeof data.expire === "number" ? data.expire : 7200;
  if (data.code !== 0 || !accessToken) {
    throw new Error(`Feishu auth failed: ${data.msg ?? "unknown"}`);
  }

  state.accessToken = accessToken;
  state.expiresAtMs = Date.now() + expireSec * 1000;
  return accessToken;
}

async function sendSingleTextMessage(params: {
  config: FeishuAdapterTokenConfig;
  tokenState: FeishuTokenState;
  chatId: string;
  text: string;
  replyToMessageId?: string;
}): Promise<void> {
  const accessToken = await getTenantAccessToken(params.config, params.tokenState);

  const replyTarget = params.replyToMessageId?.trim();
  const endpoint = replyTarget
    ? `${params.config.apiBase}/im/v1/messages/${encodeURIComponent(replyTarget)}/reply`
    : `${params.config.apiBase}/im/v1/messages?receive_id_type=chat_id`;

  const body = replyTarget
    ? {
        content: JSON.stringify({ text: params.text }),
        msg_type: "text",
      }
    : {
        receive_id: params.chatId,
        content: JSON.stringify({ text: params.text }),
        msg_type: "text",
      };

  const data = await fetchJson(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (data.code !== 0) {
    throw new Error(`Feishu send message failed: ${data.msg ?? "unknown"}`);
  }
}

export async function sendFeishuMessage(params: {
  config: FeishuAdapterTokenConfig;
  tokenState: FeishuTokenState;
  chatId: string;
  content: MessageContent;
  replyToMessageId?: string;
}): Promise<void> {
  const text = buildFeishuText(params.content).trim();
  if (!text) return;

  const chunks = splitTextForFeishu(text);
  for (let i = 0; i < chunks.length; i++) {
    await sendSingleTextMessage({
      config: params.config,
      tokenState: params.tokenState,
      chatId: params.chatId,
      text: chunks[i],
      replyToMessageId: i === 0 ? params.replyToMessageId : undefined,
    });
  }
}
