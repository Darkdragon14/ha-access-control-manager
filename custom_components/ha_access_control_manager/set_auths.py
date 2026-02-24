from typing import Any
import voluptuous as vol
import os

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file, save_json_file
from .const import (
    AUTH_PATH,
    NEW_AUTH_PATH,
    GROUP_DASHBOARD_PERMISSIONS_PATH,
    LOVELACE_DASHBOARDS_PATH,
    LOVELACE_STORAGE,
    LOVELACE_STORAGE_PREFIX,
)

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

    dashboards_payload_present = isinstance(msg.get("data"), dict) and "dashboards" in msg["data"]
    dashboards_payload: dict[str, Any] = {}
    if dashboards_payload_present:
        raw_dashboards = msg["data"].get("dashboards")
        if isinstance(raw_dashboards, dict):
            dashboards_payload = raw_dashboards

    sanitized_data = {k: v for k, v in msg["data"].items() if k != "dashboards"}

    for item in auth_data["data"][key]:
        if item["id"] == sanitized_data["id"]:
            item.update(sanitized_data)
            isExist = True
    if not isExist:
        auth_data["data"][key].append(sanitized_data)

    await save_json_file(new_file_path, auth_data)

    if dashboards_payload_present and sanitized_data.get("id"):
        if msg["isAnUser"]:
            await _save_user_dashboards(
                hass,
                sanitized_data["id"],
                dashboards_payload,
            )
        else:
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

    auth_path = hass.config.path(AUTH_PATH)
    os.replace(new_file_path, auth_path)


async def _save_user_dashboards(hass: HomeAssistant, user_id: str, dashboards: dict[str, Any]) -> None:
    if not user_id or not isinstance(dashboards, dict):
        return

    dashboard_definitions = await _load_dashboard_definitions(hass)
    active_user_ids = await _load_active_user_ids(hass)
    if user_id not in active_user_ids:
        active_user_ids.append(user_id)

    for dashboard_id, dashboard_state in dashboards.items():
        if not isinstance(dashboard_id, str) or not dashboard_id:
            continue

        if not isinstance(dashboard_state, dict):
            continue

        dashboard_info = dashboard_definitions.get(dashboard_id, {})
        filename = dashboard_info.get("filename") if isinstance(dashboard_info, dict) else None
        if not isinstance(filename, str) or not filename:
            filename = LOVELACE_STORAGE if dashboard_id == "lovelace" else f"{LOVELACE_STORAGE_PREFIX}{dashboard_id}"

        storage, file_path = await _load_dashboard_storage(hass, dashboard_id, filename)
        if not isinstance(storage, dict) or not file_path:
            continue

        data = storage.get("data")
        if not isinstance(data, dict):
            continue

        config = data.get("config")
        if not isinstance(config, dict):
            continue

        views = config.get("views")
        if not isinstance(views, list):
            continue

        view_states = dashboard_state.get("views")
        dashboard_visible = dashboard_state.get("visible")
        changed = False

        for index, view in enumerate(views):
            if not isinstance(view, dict):
                continue

            view_id = _build_view_id(dashboard_id, view, index)
            target_state: bool | None = None

            if isinstance(view_states, dict) and view_id in view_states:
                target_state = view_states.get(view_id) is True
            elif isinstance(dashboard_visible, bool):
                target_state = dashboard_visible

            if target_state is None:
                continue

            if _set_user_view_visibility(view, user_id, target_state, active_user_ids):
                changed = True

        if changed:
            await save_json_file(file_path, storage)


async def _load_dashboard_definitions(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    dashboards_store = await get_json_file(hass.config.path(LOVELACE_DASHBOARDS_PATH))
    if not isinstance(dashboards_store, dict):
        return {}

    data = dashboards_store.get("data")
    if not isinstance(data, dict):
        return {}

    result: dict[str, dict[str, Any]] = {}

    items = data.get("items")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue

            dashboard_id = item.get("id")
            if not isinstance(dashboard_id, str) or not dashboard_id:
                continue

            result[dashboard_id] = item

    dashboards = data.get("dashboards")
    if isinstance(dashboards, dict):
        for dashboard_id, dashboard_info in dashboards.items():
            if not isinstance(dashboard_id, str) or not dashboard_id:
                continue

            if dashboard_id in result:
                continue

            result[dashboard_id] = dashboard_info if isinstance(dashboard_info, dict) else {}

    return result


async def _load_active_user_ids(hass: HomeAssistant) -> list[str]:
    user_ids: list[str] = []

    for user in await hass.auth.async_get_users():
        if not getattr(user, "is_active", False):
            continue

        if getattr(user, "system_generated", False):
            continue

        user_ids.append(user.id)

    return user_ids


async def _load_dashboard_storage(
    hass: HomeAssistant,
    dashboard_id: str,
    filename: str,
) -> tuple[dict[str, Any] | None, str | None]:
    candidates = [filename]
    if dashboard_id == "lovelace":
        fallback_filename = f"{LOVELACE_STORAGE_PREFIX}lovelace"
        if filename == LOVELACE_STORAGE:
            candidates = [fallback_filename, filename]
        elif fallback_filename not in candidates:
            candidates.append(fallback_filename)

    for candidate in candidates:
        file_path = hass.config.path(candidate)
        if not os.path.exists(file_path):
            continue

        storage = await get_json_file(file_path)
        if isinstance(storage, dict):
            return storage, file_path

    return None, None


def _build_view_id(dashboard_id: str, view: dict[str, Any], index: int) -> str:
    path = view.get("path")
    if isinstance(path, str) and path:
        return path

    view_id = view.get("id")
    if isinstance(view_id, str) and view_id:
        return view_id

    return f"{dashboard_id}-view-{index}"


def _set_user_view_visibility(
    view: dict[str, Any],
    user_id: str,
    target_visible: bool,
    active_user_ids: list[str],
) -> bool:
    raw_visible = view.get("visible") if "visible" in view else None

    if isinstance(raw_visible, list):
        entries = [item for item in raw_visible if isinstance(item, dict)]
        had_user = any(item.get("user") == user_id for item in entries)

        if target_visible:
            if had_user:
                return False

            entries.append({"user": user_id})
            view["visible"] = entries
            return True

        updated_entries = [item for item in entries if item.get("user") != user_id]
        if len(updated_entries) == len(entries):
            return False

        view["visible"] = updated_entries
        return True

    if target_visible:
        if raw_visible is None:
            return False

        view["visible"] = [{"user": user_id}]
        return True

    allowed_user_ids = [entry_user_id for entry_user_id in active_user_ids if entry_user_id != user_id]
    explicit_visible = [{"user": entry_user_id} for entry_user_id in allowed_user_ids]

    if isinstance(raw_visible, list) and raw_visible == explicit_visible:
        return False

    if raw_visible is None and explicit_visible == [] and "visible" in view and view.get("visible") == []:
        return False

    view["visible"] = explicit_visible
    return True


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
