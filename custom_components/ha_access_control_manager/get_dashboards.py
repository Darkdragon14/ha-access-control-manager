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


@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_dashboards"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_dashboards(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    dashboards = await _async_collect_dashboards(hass)
    connection.send_result(msg["id"], dashboards)


async def _async_collect_dashboards(hass: HomeAssistant) -> list[dict[str, Any]]:
    dashboards: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    dashboards_store = await get_json_file(hass.config.path(LOVELACE_DASHBOARDS_PATH))
    dashboards_data = dashboards_store.get("data", {}) if dashboards_store else {}

    for dashboard_id, dashboard_info in dashboards_data.get("dashboards", {}).items():
        dashboard = await _async_build_dashboard_entry(
            hass,
            dashboard_id,
            dashboard_info if isinstance(dashboard_info, dict) else {},
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
        )
        if dashboard:
            dashboards.append(dashboard)
            seen_ids.add(dashboard_id)

    return dashboards


async def _async_build_dashboard_entry(
    hass: HomeAssistant,
    dashboard_id: str,
    dashboard_info: dict[str, Any],
) -> dict[str, Any] | None:
    if not isinstance(dashboard_info, dict):
        dashboard_info = {}

    filename = dashboard_info.get("filename")
    if not filename:
        filename = LOVELACE_STORAGE if dashboard_id == "lovelace" else f"{LOVELACE_STORAGE_PREFIX}{dashboard_id}"

    config = await _async_load_dashboard_config(hass, filename)

    views = []
    if config:
        for index, view in enumerate(config.get("views", [])):
            view_id = view.get("path") or view.get("id") or f"{dashboard_id}-view-{index}"
            view_name = view.get("title") or view.get("path") or f"View {index + 1}"
            views.append(
                {
                    "id": view_id,
                    "name": view_name,
                    "path": view.get("path"),
                    "visible": False,
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
