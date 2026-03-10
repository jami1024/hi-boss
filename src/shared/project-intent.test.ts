import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProjectChatIntent,
  deriveProjectTaskTitleFromMessage,
} from "./project-intent.js";

test("classifyProjectChatIntent detects requirement-style requests", () => {
  assert.equal(classifyProjectChatIntent("请帮我实现登录功能并补上测试"), "requirement");
  assert.equal(classifyProjectChatIntent("需求：优化首页加载速度"), "requirement");
  assert.equal(classifyProjectChatIntent("[task] Build onboarding flow"), "requirement");
});

test("classifyProjectChatIntent keeps simple questions as qa", () => {
  assert.equal(classifyProjectChatIntent("这个项目是做什么的？"), "qa");
  assert.equal(classifyProjectChatIntent("How does project memory work?"), "qa");
  assert.equal(classifyProjectChatIntent("[qa] 你是谁？"), "qa");
});

test("deriveProjectTaskTitleFromMessage normalizes title text", () => {
  assert.equal(
    deriveProjectTaskTitleFromMessage("[task]   请帮我实现登录功能\n验收：支持邮箱密码"),
    "请帮我实现登录功能"
  );
  assert.equal(deriveProjectTaskTitleFromMessage(""), "自动识别需求");
  assert.ok(deriveProjectTaskTitleFromMessage("x".repeat(200)).length <= 80);
});
