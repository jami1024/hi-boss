import assert from "node:assert/strict";
import test from "node:test";
import { parseFeishuIncomingPayload } from "./incoming.js";

test("parseFeishuIncomingPayload handles url_verification", () => {
  const parsed = parseFeishuIncomingPayload({
    type: "url_verification",
    challenge: "challenge_token",
    token: "verification_token",
  });

  assert.equal(parsed.kind, "challenge");
  if (parsed.kind === "challenge") {
    assert.equal(parsed.challenge, "challenge_token");
    assert.equal(parsed.token, "verification_token");
  }
});

test("parseFeishuIncomingPayload parses message receive event", () => {
  const parsed = parseFeishuIncomingPayload({
    schema: "2.0",
    header: {
      event_type: "im.message.receive_v1",
      token: "verification_token",
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
        parent_id: "om_parent_1",
        chat_id: "oc_chat_1",
        message_type: "text",
        content: JSON.stringify({ text: "hello feishu" }),
      },
    },
  });

  assert.equal(parsed.kind, "message");
  if (parsed.kind === "message") {
    assert.equal(parsed.token, "verification_token");
    assert.equal(parsed.message.id, "om_message_1");
    assert.equal(parsed.message.platform, "feishu");
    assert.equal(parsed.message.author.id, "ou_user_1");
    assert.equal(parsed.message.author.username, "user_1");
    assert.equal(parsed.message.chat.id, "oc_chat_1");
    assert.equal(parsed.message.content.text, "hello feishu");
    assert.equal(parsed.message.inReplyTo?.channelMessageId, "om_parent_1");
  }
});

test("parseFeishuIncomingPayload ignores non-message event type", () => {
  const parsed = parseFeishuIncomingPayload({
    schema: "2.0",
    header: {
      event_type: "im.chat.member.bot.added_v1",
    },
    event: {},
  });

  assert.equal(parsed.kind, "ignore");
});
