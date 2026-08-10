from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api


@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_users"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_users(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    result = []
    for user in await hass.auth.async_get_users():
        if not user.is_active or user.system_generated:
            continue

        ha_username = next(
            (
                credential.data.get("username")
                for credential in user.credentials
                if credential.auth_provider_type == "homeassistant"
            ),
            None,
        )
        display_name = ha_username or user.name or user.id

        result.append(
            {
                "id": user.id,
                "username": display_name,
                "group_ids": [group.id for group in user.groups],
            }
        )
    connection.send_result(msg["id"], result)
