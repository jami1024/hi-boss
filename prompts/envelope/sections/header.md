envelope-id: {{ envelope.idShort }}
from: {{ envelope.from }}
to: {{ envelope.to }}
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
