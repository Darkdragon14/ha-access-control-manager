from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file, save_json_file
from .const import AUTH_PATH, NEW_AUTH_PATH

@websocket_api.websocket_command({
    vol.Required("type"): "ha_access_control/set_auths",
    vol.Required("isAnUser"): bool,
    vol.Required("data"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def set_auths(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    file_path = hass.config.path(AUTH_PATH)
    new_file_path = hass.config.path(NEW_AUTH_PATH)

    auth_data = await get_json_file(new_file_path)
    if auth_data:
        await save_auths(hass, auth_data, msg)
        connection.send_result(msg["id"], auth_data["data"])
    else:
        auth_data = await get_json_file(file_path)
        if auth_data:
            await save_auths(hass, auth_data, msg)
        else:
            connection.send_error(msg["id"], "file_error", "Error reading auth file.")
            return
    connection.send_result(msg["id"], auth_data["data"])


async def save_auths(hass: HomeAssistant, auth_data: dict, msg: dict[str, Any]) -> None:
    new_file_path = hass.config.path(NEW_AUTH_PATH)
    isExist = False
    key = 'groups'
    if msg["isAnUser"]:
        key = 'users'

    for item in auth_data["data"][key]:
        if item["id"] == msg["data"]["id"]:
            item.update(msg["data"])
            isExist = True
    if not isExist:
        auth_data["data"][key].append(msg["data"])

    await save_json_file(new_file_path, auth_data)