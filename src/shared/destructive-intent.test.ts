import assert from "node:assert/strict";
import test from "node:test";
import {
  hasDestructiveIntent,
  stripDestructiveConfirmationPrefix,
  DESTRUCTIVE_CONFIRMATION_TEXT,
} from "./destructive-intent.js";

test("hasDestructiveIntent returns false for empty/undefined input", () => {
  assert.equal(hasDestructiveIntent(undefined), false);
  assert.equal(hasDestructiveIntent(""), false);
});

test("hasDestructiveIntent detects English keywords", () => {
  assert.equal(hasDestructiveIntent("delete the test folder"), true);
  assert.equal(hasDestructiveIntent("rm -rf /tmp/test"), true);
  assert.equal(hasDestructiveIntent("drop table users"), true);
  assert.equal(hasDestructiveIntent("wipe all data"), true);
  assert.equal(hasDestructiveIntent("reset the database"), true);
  assert.equal(hasDestructiveIntent("remove old logs"), true);
});

test("hasDestructiveIntent detects Chinese keywords", () => {
  assert.equal(hasDestructiveIntent("删除test目录"), true);
  assert.equal(hasDestructiveIntent("清空数据库"), true);
  assert.equal(hasDestructiveIntent("重置配置"), true);
  assert.equal(hasDestructiveIntent("移除旧文件"), true);
  assert.equal(hasDestructiveIntent("格式化磁盘"), true);
  assert.equal(hasDestructiveIntent("销毁备份"), true);
});

test("hasDestructiveIntent returns false for safe messages", () => {
  assert.equal(hasDestructiveIntent("read the file"), false);
  assert.equal(hasDestructiveIntent("list all agents"), false);
  assert.equal(hasDestructiveIntent("hello"), false);
  assert.equal(hasDestructiveIntent("帮我看看日志"), false);
});

test("stripDestructiveConfirmationPrefix returns undefined for non-confirmed text", () => {
  assert.equal(stripDestructiveConfirmationPrefix(undefined), undefined);
  assert.equal(stripDestructiveConfirmationPrefix(""), undefined);
  assert.equal(stripDestructiveConfirmationPrefix("delete test"), undefined);
});

test("stripDestructiveConfirmationPrefix strips Chinese confirmation prefixes", () => {
  assert.equal(stripDestructiveConfirmationPrefix("确认执行：删除test目录"), "删除test目录");
  assert.equal(stripDestructiveConfirmationPrefix("确认操作：清空数据库"), "清空数据库");
  assert.equal(stripDestructiveConfirmationPrefix("确认删除：test文件夹"), "test文件夹");
});

test("stripDestructiveConfirmationPrefix strips English confirm prefix", () => {
  assert.equal(stripDestructiveConfirmationPrefix("confirm: delete test dir"), "delete test dir");
  assert.equal(stripDestructiveConfirmationPrefix("confirm delete test dir"), "delete test dir");
});

test("DESTRUCTIVE_CONFIRMATION_TEXT is a non-empty string", () => {
  assert.ok(DESTRUCTIVE_CONFIRMATION_TEXT.length > 0);
  assert.ok(DESTRUCTIVE_CONFIRMATION_TEXT.includes("确认执行"));
});
