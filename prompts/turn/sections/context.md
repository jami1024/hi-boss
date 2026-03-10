## Turn Context

now: {{ turn.datetimeIso }}
pending-envelopes: {{ turn.envelopeCount }}
{% if turn.recalledMemory %}

## Recalled Memory (relevant to current envelopes)

The following memory fragments were retrieved based on relevance to the current turn.
They supplement (not replace) your long-term and daily memory snapshots from the system prompt.

{{ turn.recalledMemory }}
{% endif %}

Reminder:
- If you decide a response is needed, send it via `hiboss envelope send` (or `hiboss reaction set` for a reaction).
- Follow Operating Rules: do not reply to every envelope (especially in group chats); stay silent when no response is necessary.
