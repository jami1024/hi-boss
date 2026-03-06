import type { ChannelMessage } from "../types.js";

type FeishuDict = Record<string, unknown>;

export type FeishuIncomingParseResult =
  | { kind: "challenge"; challenge: string; token?: string }
  | { kind: "message"; message: ChannelMessage; token?: string }
  | { kind: "ignore" }
  | { kind: "error"; message: string };

function asDict(value: unknown): FeishuDict | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as FeishuDict;
}

function parseMessageContent(raw: unknown): FeishuDict {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return asDict(parsed) ?? {};
  } catch {
    return {};
  }
}

function parseTextFromEvent(messageType: string, content: FeishuDict): string | undefined {
  const text = typeof content.text === "string" ? content.text.trim() : "";
  if (messageType === "text") {
    return text || undefined;
  }
  if (text) {
    return text;
  }
  return `[feishu:${messageType}]`;
}

export function parseFeishuIncomingPayload(payload: unknown): FeishuIncomingParseResult {
  const root = asDict(payload);
  if (!root) {
    return { kind: "error", message: "Invalid feishu event payload" };
  }

  const challenge = typeof root.challenge === "string" ? root.challenge : undefined;
  const rootToken = typeof root.token === "string" ? root.token : undefined;
  if (typeof root.type === "string" && root.type === "url_verification" && challenge) {
    return { kind: "challenge", challenge, token: rootToken };
  }

  if (typeof root.encrypt === "string" && root.encrypt.trim()) {
    return { kind: "error", message: "Feishu encrypted events are not supported in MVP" };
  }

  const header = asDict(root.header);
  if (!header) return { kind: "ignore" };

  const eventType = typeof header.event_type === "string" ? header.event_type : "";
  const headerToken = typeof header.token === "string" ? header.token : undefined;
  if (eventType !== "im.message.receive_v1") {
    return { kind: "ignore" };
  }

  const event = asDict(root.event);
  if (!event) {
    return { kind: "error", message: "Invalid feishu event payload (missing event)" };
  }

  const message = asDict(event.message);
  const sender = asDict(event.sender);
  const senderId = asDict(sender?.sender_id);
  if (!message || !senderId) {
    return { kind: "error", message: "Invalid feishu event payload (missing message/sender)" };
  }

  const messageId = typeof message.message_id === "string" ? message.message_id.trim() : "";
  const chatId = typeof message.chat_id === "string" ? message.chat_id.trim() : "";
  const messageType =
    typeof message.message_type === "string" && message.message_type.trim()
      ? message.message_type.trim()
      : "unknown";
  if (!messageId || !chatId) {
    return { kind: "error", message: "Invalid feishu event payload (missing message_id/chat_id)" };
  }

  const parsedContent = parseMessageContent(message.content);
  const text = parseTextFromEvent(messageType, parsedContent);

  const openId = typeof senderId.open_id === "string" ? senderId.open_id.trim() : "";
  const userId = typeof senderId.user_id === "string" ? senderId.user_id.trim() : "";
  const unionId = typeof senderId.union_id === "string" ? senderId.union_id.trim() : "";
  const authorId = openId || userId || unionId || "unknown";

  const parentId = typeof message.parent_id === "string" ? message.parent_id.trim() : "";

  const channelMessage: ChannelMessage = {
    id: messageId,
    platform: "feishu",
    author: {
      id: authorId,
      username: userId || undefined,
      displayName: openId || userId || unionId || "unknown",
    },
    ...(parentId
      ? {
          inReplyTo: {
            channelMessageId: parentId,
          },
        }
      : {}),
    chat: {
      id: chatId,
    },
    content: {
      text,
    },
    raw: payload,
  };

  return { kind: "message", message: channelMessage, token: headerToken ?? rootToken };
}
