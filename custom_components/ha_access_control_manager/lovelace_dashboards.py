"""Storage dashboards, read and saved through Home Assistant's Lovelace integration.

Home Assistant keeps storage dashboards in memory. Saving through it (as the
dashboard editor does) updates memory and file and makes open frontends reload,
so changes are active at once instead of after the next restart.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from homeassistant.components.lovelace.const import (
    LOVELACE_DATA,
    MODE_STORAGE,
    ConfigNotFound,
)
from homeassistant.core import HomeAssistant

DEFAULT_DASHBOARD_ID = "lovelace"
DEFAULT_DASHBOARD_TITLE = "Lovelace"


@dataclass(frozen=True)
class StorageDashboard:
    """A dashboard stored by Home Assistant (not a YAML dashboard)."""

    # ID of the dashboard entry, or "lovelace" for the built-in default dashboard.
    id: str
    title: str | None
    url_path: str
    lovelace: Any

    async def async_load_config(self) -> dict[str, Any] | None:
        """Return a copy of the config, or None if the dashboard has none yet."""
        try:
            config = await self.lovelace.async_load(False)
        except ConfigNotFound:
            return None
        return copy.deepcopy(config) if isinstance(config, dict) else None

    async def async_save_config(self, config: dict[str, Any]) -> None:
        """Save the config the way the dashboard editor does."""
        await self.lovelace.async_save(config)


def get_storage_dashboards(hass: HomeAssistant) -> list[StorageDashboard]:
    """Return all storage dashboards known to Home Assistant."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        return []

    dashboards: dict[str, StorageDashboard] = {}
    default_dashboard = None
    for url_path, lovelace in lovelace_data.dashboards.items():
        if getattr(lovelace, "mode", None) != MODE_STORAGE:
            continue

        if url_path is None:
            default_dashboard = lovelace
            continue

        config = lovelace.config if isinstance(lovelace.config, dict) else {}
        dashboard_id = config.get("id") or url_path
        dashboards[dashboard_id] = StorageDashboard(
            id=dashboard_id,
            title=config.get("title"),
            url_path=url_path,
            lovelace=lovelace,
        )

    # A dashboard created at the url path "lovelace" replaces the built-in default.
    if default_dashboard is not None and DEFAULT_DASHBOARD_ID not in dashboards:
        dashboards[DEFAULT_DASHBOARD_ID] = StorageDashboard(
            id=DEFAULT_DASHBOARD_ID,
            title=DEFAULT_DASHBOARD_TITLE,
            url_path=DEFAULT_DASHBOARD_ID,
            lovelace=default_dashboard,
        )

    return list(dashboards.values())
