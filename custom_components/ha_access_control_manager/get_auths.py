from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file
from .const import AUTH_PATH, NEW_AUTH_PATH

@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_auths"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_auths(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    file_path = hass.config.path(AUTH_PATH)
    new_file_path = hass.config.path(NEW_AUTH_PATH)

    auth_data = await get_json_file(new_file_path)
    if auth_data:
        connection.send_result(msg["id"], auth_data["data"])
    else:
        auth_data = await get_json_file(file_path)
        if auth_data:
            connection.send_result(msg["id"], auth_data["data"])
        else:
            connection.send_error(msg["id"], "file_error", "Error reading auth file.")