from __future__ import annotations

from typing import Any
import os
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file
from .const import (
    LOVELACE_DASHBOARDS_PATH,
    LOVELACE_STORAGE,
    LOVELACE_STORAGE_DIR,
    LOVELACE_STORAGE_PREFIX,
)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_access_control/list_dashboards",
        vol.Optional("user_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def list_dashboards(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    user_id = msg.get("user_id")
    dashboards = await _async_collect_dashboards(
        hass,
        user_id if isinstance(user_id, str) and user_id else None,
    )
    connection.send_result(msg["id"], dashboards)


async def _async_collect_dashboards(
    hass: HomeAssistant,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    dashboards: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    dashboards_store = await get_json_file(hass.config.path(LOVELACE_DASHBOARDS_PATH))
    dashboards_data = dashboards_store.get("data", {}) if isinstance(dashboards_store, dict) else {}

    for dashboard_id, dashboard_info in _extract_dashboard_entries(dashboards_data):
        dashboard = await _async_build_dashboard_entry(
            hass,
            dashboard_id,
            dashboard_info,
            user_id,
        )
        if dashboard:
            dashboards.append(dashboard)
            seen_ids.add(dashboard_id)

    if "lovelace" not in seen_ids:
        default_dashboard = await _async_build_dashboard_entry(
            hass,
            "lovelace",
            {
                "title": "Lovelace",
                "url_path": "lovelace",
                "filename": LOVELACE_STORAGE,
            },
            user_id,
        )
        if default_dashboard:
            dashboards.append(default_dashboard)
            seen_ids.add("lovelace")

    storage_files = await _async_list_storage_files(hass)
    for filename in storage_files:
        if not filename.startswith("lovelace."):
            continue
        dashboard_id = filename[len("lovelace.") :]
        if not dashboard_id or dashboard_id in seen_ids:
            continue
        dashboard = await _async_build_dashboard_entry(
            hass,
            dashboard_id,
            {
                "filename": f"{LOVELACE_STORAGE_DIR}/{filename}",
                "url_path": dashboard_id,
            },
            user_id,
        )
        if dashboard:
            dashboards.append(dashboard)
            seen_ids.add(dashboard_id)

    return dashboards


async def _async_build_dashboard_entry(
    hass: HomeAssistant,
    dashboard_id: str,
    dashboard_info: dict[str, Any],
    user_id: str | None = None,
) -> dict[str, Any] | None:
    if not isinstance(dashboard_info, dict):
        dashboard_info = {}

    filename = dashboard_info.get("filename")
    if not filename:
        filename = LOVELACE_STORAGE if dashboard_id == "lovelace" else f"{LOVELACE_STORAGE_PREFIX}{dashboard_id}"

    config = None
    if dashboard_id == "lovelace":
        fallback_filename = f"{LOVELACE_STORAGE_PREFIX}lovelace"
        if filename == LOVELACE_STORAGE:
            config = await _async_load_dashboard_config(hass, fallback_filename)

        if config is None:
            config = await _async_load_dashboard_config(hass, filename)

        if config is None and fallback_filename != filename:
            config = await _async_load_dashboard_config(hass, fallback_filename)
    else:
        config = await _async_load_dashboard_config(hass, filename)

    views = []
    if config:
        for index, view in enumerate(config.get("views", [])):
            if not isinstance(view, dict):
                continue

            view_id = view.get("path") or view.get("id") or f"{dashboard_id}-view-{index}"
            view_name = view.get("title") or view.get("path") or f"View {index + 1}"
            views.append(
                {
                    "id": view_id,
                    "name": view_name,
                    "path": view.get("path"),
                    "visible": _is_view_visible_for_user(view, user_id),
                }
            )

    dashboard_name = dashboard_info.get("title") or (config.get("title") if config else None) or dashboard_id

    return {
        "id": dashboard_id,
        "name": dashboard_name,
        "url_path": dashboard_info.get("url_path", dashboard_id),
        "visible": False,
        "views": views,
    }


async def _async_load_dashboard_config(hass: HomeAssistant, filename: str) -> dict[str, Any] | None:
    storage = await get_json_file(hass.config.path(filename))
    if not storage:
        return None

    data = storage.get("data")
    if not isinstance(data, dict):
        return None

    config = data.get("config")
    return config if isinstance(config, dict) else None


async def _async_list_storage_files(hass: HomeAssistant) -> list[str]:
    storage_dir = hass.config.path(LOVELACE_STORAGE_DIR)
    try:
        return await hass.async_add_executor_job(os.listdir, storage_dir)
    except FileNotFoundError:
        return []


def _extract_dashboard_entries(dashboards_data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    if not isinstance(dashboards_data, dict):
        return []

    entries: list[tuple[str, dict[str, Any]]] = []
    seen_ids: set[str] = set()

    items = dashboards_data.get("items")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue

            dashboard_id = item.get("id")
            if not isinstance(dashboard_id, str) or not dashboard_id or dashboard_id in seen_ids:
                continue

            entries.append((dashboard_id, item))
            seen_ids.add(dashboard_id)

    dashboards = dashboards_data.get("dashboards")
    if isinstance(dashboards, dict):
        for dashboard_id, dashboard_info in dashboards.items():
            if not isinstance(dashboard_id, str) or not dashboard_id or dashboard_id in seen_ids:
                continue

            entries.append((dashboard_id, dashboard_info if isinstance(dashboard_info, dict) else {}))
            seen_ids.add(dashboard_id)

    return entries


def _is_view_visible_for_user(view: dict[str, Any], user_id: str | None) -> bool:
    if not user_id:
        return False

    visible = view.get("visible")
    if visible is None:
        return True

    if not isinstance(visible, list):
        return False

    return any(
        isinstance(entry, dict) and entry.get("user") == user_id
        for entry in visible
    )
