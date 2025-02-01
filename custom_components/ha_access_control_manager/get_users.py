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
        ha_username = next((cred.data.get("username") for cred in user.credentials if cred.auth_provider_type == "homeassistant"), None)
        if (ha_username is None or user.is_active is False):
            continue

        result.append({
            "id": user.id,
            "username": ha_username,
            "group_ids": [group.id for group in user.groups]
        })
    connection.send_result(msg["id"], result)