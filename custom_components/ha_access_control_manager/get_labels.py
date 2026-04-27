from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

try:
    from homeassistant.helpers import label_registry as lr
except ImportError:  # pragma: no cover - older Home Assistant versions
    lr = None


@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_labels"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_labels(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    if lr is None:
        connection.send_result(msg["id"], [])
        return

    label_registry = lr.async_get(hass)
    labels = [
        {
            "id": label.label_id,
            "name": label.name,
        }
        for label in label_registry.async_list_labels()
    ]

    labels.sort(key=lambda label: label["name"].lower())
    connection.send_result(msg["id"], labels)
