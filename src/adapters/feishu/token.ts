const DEFAULT_API_BASE = "https://open.feishu.cn/open-apis";
const DEFAULT_WEBHOOK_HOST = "127.0.0.1";
const DEFAULT_WEBHOOK_PORT = 16666;
const DEFAULT_WEBHOOK_PATH = "/feishu/events";

export interface FeishuAdapterTokenConfig {
  appId: string;
  appSecret: string;
  apiBase: string;
  verificationToken?: string;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  webhookEnabled: boolean;
}

function normalizeMaybe(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeApiBase(value: string | undefined): string {
  const base = (value ?? DEFAULT_API_BASE).trim();
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("Invalid feishu adapter token (apiBase must be http/https)");
  }
  return base.replace(/\/+$/, "");
}

function parseWebhookPort(raw: string | undefined): number {
  if (!raw) return DEFAULT_WEBHOOK_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error("Invalid feishu adapter token (webhookPort must be an integer 1-65535)");
  }
  return n;
}

function parseWebhookPath(raw: string | undefined): string {
  if (!raw) return DEFAULT_WEBHOOK_PATH;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error("Invalid feishu adapter token (webhookPath must start with '/')");
  }
  return trimmed;
}

function parseTokenObject(raw: string): Record<string, string> {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid feishu adapter token (invalid JSON)");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid feishu adapter token (JSON must be an object)");
    }

    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") {
        result[k] = v;
      }
    }
    return result;
  }

  if (!trimmed.includes("=") && trimmed.includes(":")) {
    const idx = trimmed.indexOf(":");
    const appId = trimmed.slice(0, idx).trim();
    const appSecret = trimmed.slice(idx + 1).trim();
    return { appId, appSecret };
  }

  const normalized = trimmed.replace(/;/g, "&");
  const params = new URLSearchParams(normalized);
  const result: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    result[k] = v;
  }
  return result;
}

export function parseFeishuAdapterToken(adapterToken: string): FeishuAdapterTokenConfig {
  const trimmed = adapterToken.trim();
  if (!trimmed) {
    throw new Error("Invalid feishu adapter token (empty)");
  }

  const raw = parseTokenObject(trimmed);
  const appId = normalizeMaybe(raw.appId) ?? normalizeMaybe(raw.app_id);
  const appSecret = normalizeMaybe(raw.appSecret) ?? normalizeMaybe(raw.app_secret);

  if (!appId) {
    throw new Error("Invalid feishu adapter token (missing appId/app_id)");
  }
  if (!appSecret) {
    throw new Error("Invalid feishu adapter token (missing appSecret/app_secret)");
  }

  const verificationToken =
    normalizeMaybe(raw.verificationToken) ?? normalizeMaybe(raw.verification_token);
  const webhookHost = normalizeMaybe(raw.webhookHost) ?? normalizeMaybe(raw.webhook_host) ?? DEFAULT_WEBHOOK_HOST;
  const webhookPort = parseWebhookPort(
    normalizeMaybe(raw.webhookPort) ?? normalizeMaybe(raw.webhook_port)
  );
  const webhookPath = parseWebhookPath(
    normalizeMaybe(raw.webhookPath) ?? normalizeMaybe(raw.webhook_path)
  );
  const apiBase = normalizeApiBase(normalizeMaybe(raw.apiBase) ?? normalizeMaybe(raw.api_base));

  return {
    appId,
    appSecret,
    apiBase,
    verificationToken,
    webhookHost,
    webhookPort,
    webhookPath,
    webhookEnabled: Boolean(verificationToken),
  };
}
