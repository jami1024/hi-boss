# Feishu Adapter

The Feishu adapter connects Hi-Boss to Feishu chats and maps events/messages to envelopes.

Key files:
- `src/adapters/feishu.adapter.ts`
- `src/adapters/feishu/token.ts`
- `src/adapters/feishu/incoming.ts`
- `src/adapters/feishu/outgoing.ts`

## Token Format (binding)

Feishu binding token is stored in `agent_bindings.adapter_token` and parsed by the adapter.

Supported forms:

1) Short form (outgoing-only):

```text
<appId>:<appSecret>
```

2) JSON form (recommended for inbound webhook):

```json
{
  "app_id": "cli_xxx",
  "app_secret": "secret_xxx",
  "verification_token": "verify_xxx",
  "webhook_host": "127.0.0.1",
  "webhook_port": "16666",
  "webhook_path": "/feishu/events",
  "api_base": "https://open.feishu.cn/open-apis"
}
```

When `verification_token` is missing, adapter runs in outgoing-only mode.

## Flow

Incoming (Feishu -> agent):
- Feishu pushes event callback to adapter webhook.
- Adapter parses `im.message.receive_v1` and emits `ChannelMessage`.
- `ChannelBridge` converts it to envelope:
  - `from: channel:feishu:<chat-id>`
  - `to: agent:<bound-agent-name>`

Outgoing (agent -> Feishu):
- Agent sends `hiboss envelope send --to channel:feishu:<chat-id> ...`
- Router resolves Feishu adapter and calls `sendMessage`.
- Adapter fetches tenant access token (`auth/v3/tenant_access_token/internal`) and sends text message (`im/v1/messages`).

## Webhook Binding Model

- Webhook URL belongs to adapter instance, not directly to agent.
- Agent association is via binding identity:
  - `agent_bindings.adapter_type = feishu`
  - `agent_bindings.adapter_token = <feishu-token-config>`
- Incoming webhook event is routed to whichever agent is bound to that adapter token.

## Current MVP Limits

- Inbound encrypted events (`encrypt`) are not supported.
- Outgoing currently sends text payloads; attachments are rendered as text lines.
- Command channel (`/new`, `/status`, `/abort`) is Telegram-specific; Feishu adapter does not expose command callbacks in MVP.
