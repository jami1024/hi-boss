envelope-id: {{ envelope.idShort }}
from: {{ envelope.from }}
{% if envelope.fromAgentName %}
from-agent-name: {{ envelope.fromAgentName }}
{% endif %}
{% if envelope.senderLine %}
sender: {{ envelope.senderLine }}
{% endif %}
created-at: {{ envelope.createdAt.iso }}
{% if envelope.deliverAt.present %}
deliver-at: {{ envelope.deliverAt.iso }}
{% endif %}
{% if envelope.cronId %}
cron-id: {{ envelope.cronId }}
{% endif %}
{% if envelope.workItem.present %}
work-item-id: {{ envelope.workItem.id }}
{% if envelope.workItem.state %}
work-item-state: {{ envelope.workItem.state }}
{% endif %}
{% if envelope.workItem.title %}
work-item-title: {{ envelope.workItem.title }}
{% endif %}
{% endif %}
{% if envelope.inReplyTo %}
{% if envelope.inReplyTo.fromName %}
in-reply-to-from-name: {{ envelope.inReplyTo.fromName }}
{% endif %}
in-reply-to-text:
{{ envelope.inReplyTo.text }}
{% endif %}

{{ envelope.content.text }}
{% if envelope.content.attachmentsText != "(none)" %}
attachments:
{{ envelope.content.attachmentsText }}
{% endif %}
