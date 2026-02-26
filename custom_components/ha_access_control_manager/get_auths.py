from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file
from .const import AUTH_PATH, NEW_AUTH_PATH, GROUP_DASHBOARD_PERMISSIONS_PATH

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
        await _attach_group_dashboards(hass, auth_data.get("data"))
        connection.send_result(msg["id"], auth_data["data"])
        return

    auth_data = await get_json_file(file_path)
    if auth_data:
        await _attach_group_dashboards(hass, auth_data.get("data"))
        connection.send_result(msg["id"], auth_data["data"])
        return

    connection.send_error(msg["id"], "file_error", "Error reading auth file.")


async def _attach_group_dashboards(hass: HomeAssistant, auth_data: dict[str, Any] | None) -> None:
    if not isinstance(auth_data, dict):
        return

    groups = auth_data.get("groups")
    if not isinstance(groups, list):
        return

    dashboards_map = await _load_group_dashboard_permissions(hass)

    for group in groups:
        if not isinstance(group, dict):
            continue
        group_id = group.get("id")
        if not group_id:
            continue
        group["dashboards"] = dashboards_map.get(group_id, {}) if dashboards_map else {}


async def _load_group_dashboard_permissions(hass: HomeAssistant) -> dict[str, Any]:
    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path)
    if not dashboards_store:
        return {}

    groups = dashboards_store.get("groups")
    return groups if isinstance(groups, dict) else {}
