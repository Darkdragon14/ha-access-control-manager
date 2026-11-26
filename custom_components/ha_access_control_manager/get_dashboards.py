from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .lovelace_dashboards import get_storage_dashboards


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

    for dashboard in get_storage_dashboards(hass):
        config = await dashboard.async_load_config()

        views = []
        if config:
            for index, view in enumerate(config.get("views", [])):
                if not isinstance(view, dict):
                    continue

                view_id = view.get("path") or view.get("id") or f"{dashboard.id}-view-{index}"
                view_name = view.get("title") or view.get("path") or f"View {index + 1}"
                views.append(
                    {
                        "id": view_id,
                        "name": view_name,
                        "path": view.get("path"),
                        "visible": _is_view_visible_for_user(view, user_id),
                    }
                )

        dashboards.append(
            {
                "id": dashboard.id,
                "name": dashboard.title or (config.get("title") if config else None) or dashboard.id,
                "url_path": dashboard.url_path,
                "visible": False,
                "views": views,
            }
        )

    return dashboards


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
