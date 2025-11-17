from typing import Any
import voluptuous as vol
import os

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file, save_json_file
from .const import AUTH_PATH, NEW_AUTH_PATH, GROUP_DASHBOARD_PERMISSIONS_PATH

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
    else:
        auth_data = await get_json_file(file_path)
        if auth_data:
            await save_auths(hass, auth_data, msg)
        else:
            connection.send_error(msg["id"], "file_error", "Error reading auth file.")
            return
    await _attach_group_dashboards(hass, auth_data.get("data"))
    connection.send_result(msg["id"], auth_data["data"])


async def save_auths(hass: HomeAssistant, auth_data: dict, msg: dict[str, Any]) -> None:
    new_file_path = hass.config.path(NEW_AUTH_PATH)
    isExist = False
    key = 'groups'
    if msg["isAnUser"]:
        key = 'users'

    dashboards_payload: dict[str, Any] | None = None
    if not msg["isAnUser"]:
        dashboards_payload = msg["data"].get("dashboards") if isinstance(msg["data"], dict) else None
        if dashboards_payload is None:
            dashboards_payload = {}

    sanitized_data = {k: v for k, v in msg["data"].items() if k != "dashboards"}

    for item in auth_data["data"][key]:
        if item["id"] == sanitized_data["id"]:
            item.update(sanitized_data)
            isExist = True
    if not isExist:
        auth_data["data"][key].append(sanitized_data)

    await save_json_file(new_file_path, auth_data)

    if dashboards_payload is not None and sanitized_data.get("id"):
        await _save_group_dashboards(
            hass,
            sanitized_data["id"],
            dashboards_payload,
        )

    # Validation logic
    valid_config = True
    for group in auth_data.get("data", {}).get("groups", []):
        if group.get("id", "").startswith("custom-group-"):
            if not group.get("policy") or not group.get("policy", {}).get("entities", {}).get("entity_ids"):
                valid_config = False
                break

    valid_file_path = hass.config.path(".storage/auth.valid")
    if valid_config:
        with open(valid_file_path, "w") as f:
            pass  # Create empty file
    else:
        if os.path.exists(valid_file_path):
            os.remove(valid_file_path)


async def _save_group_dashboards(hass: HomeAssistant, group_id: str, dashboards: dict[str, Any]) -> None:
    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path) or {}

    if not isinstance(dashboards_store, dict):
        dashboards_store = {}

    groups = dashboards_store.get("groups")
    if not isinstance(groups, dict):
        groups = {}

    groups[group_id] = dashboards
    dashboards_store["groups"] = groups

    await save_json_file(file_path, dashboards_store)


async def _attach_group_dashboards(hass: HomeAssistant, auth_data: dict[str, Any] | None) -> None:
    if not isinstance(auth_data, dict):
        return

    groups = auth_data.get("groups")
    if not isinstance(groups, list):
        return

    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path) or {}
    dashboards_map = dashboards_store.get("groups")
    if not isinstance(dashboards_map, dict):
        dashboards_map = {}

    for group in groups:
        if not isinstance(group, dict):
            continue
        group_id = group.get("id")
        if not group_id:
            continue
        group["dashboards"] = dashboards_map.get(group_id, {})
