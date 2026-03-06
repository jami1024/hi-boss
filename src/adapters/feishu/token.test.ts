import assert from "node:assert/strict";
import test from "node:test";
import { parseFeishuAdapterToken } from "./token.js";

test("parseFeishuAdapterToken supports appId:appSecret format", () => {
  const parsed = parseFeishuAdapterToken("cli_app_x:cli_secret_y");
  assert.equal(parsed.appId, "cli_app_x");
  assert.equal(parsed.appSecret, "cli_secret_y");
  assert.equal(parsed.webhookEnabled, false);
  assert.equal(parsed.apiBase, "https://open.feishu.cn/open-apis");
});

test("parseFeishuAdapterToken supports JSON format with webhook config", () => {
  const parsed = parseFeishuAdapterToken(
    JSON.stringify({
      app_id: "app_json",
      app_secret: "secret_json",
      verification_token: "verify_json",
      webhook_host: "0.0.0.0",
      webhook_port: "17777",
      webhook_path: "/events/feishu",
      api_base: "https://open.larksuite.com/open-apis",
    })
  );

  assert.equal(parsed.appId, "app_json");
  assert.equal(parsed.appSecret, "secret_json");
  assert.equal(parsed.verificationToken, "verify_json");
  assert.equal(parsed.webhookHost, "0.0.0.0");
  assert.equal(parsed.webhookPort, 17777);
  assert.equal(parsed.webhookPath, "/events/feishu");
  assert.equal(parsed.webhookEnabled, true);
  assert.equal(parsed.apiBase, "https://open.larksuite.com/open-apis");
});

test("parseFeishuAdapterToken rejects invalid webhook port", () => {
  assert.throws(
    () => parseFeishuAdapterToken("app_id=a&app_secret=b&verification_token=v&webhook_port=70000"),
    /webhookPort/
  );
});
