/**
 * Shared destructive-intent detection for boss messages.
 *
 * Used by channel-bridge (Telegram/Feishu) and web UI (REST + WebSocket)
 * to gate high-risk operations behind an explicit confirmation step.
 */

const DESTRUCTIVE_INTENT_PATTERN =
  /\b(rm|rmdir|del|delete|remove|unlink|drop|truncate|format|wipe|purge|destroy|reset)\b|删除|移除|清空|重置|格式化|销毁|抹掉/i;

const DESTRUCTIVE_CONFIRM_PREFIX_PATTERN = /^\s*(确认执行|确认操作|确认删除|confirm)\s*[:：]?\s*/i;

export function hasDestructiveIntent(text?: string): boolean {
  if (!text) return false;
  return DESTRUCTIVE_INTENT_PATTERN.test(text);
}

export function stripDestructiveConfirmationPrefix(text?: string): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const stripped = trimmed.replace(DESTRUCTIVE_CONFIRM_PREFIX_PATTERN, "").trim();
  if (stripped.length === trimmed.length || !stripped) {
    return undefined;
  }
  return stripped;
}

export const DESTRUCTIVE_CONFIRMATION_TEXT = [
  "检测到高风险操作（删除/清空/重置）。",
  "请先确认，再重新发送同一条指令：",
  "确认执行：<原指令>",
].join("\n");
