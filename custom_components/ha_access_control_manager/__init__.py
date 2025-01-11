import os
import aiofiles

from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, DEST_PATH_SCRIPT_JS, SOURCE_PATH_SCRIPT_JS, SCRIPT_JS

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the ha_access_control_manager component."""
    source_path = hass.config.path(SOURCE_PATH_SCRIPT_JS)
    dest_dir = hass.config.path(DEST_PATH_SCRIPT_JS)
    dest_path = os.path.join(dest_dir, SCRIPT_JS)

    try:
        if not os.path.exists(dest_dir):
            os.makedirs(dest_dir)

        if os.path.exists(source_path):
            await async_copy_file(source_path, dest_path)

    except Exception as e:
        return False

    return True


async def async_setup_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Set up  ha_access_control_manager from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    tab_icon = config_entry.options.get("tab_icon", config_entry.data.get("tab_icon", "mdi:shield-account"))
    tab_name = config_entry.options.get("tab_name", config_entry.data.get("tab_name", "Access Control Manager"))
    path = config_entry.options.get("path", config_entry.data.get("path_to_admin_ui", "/ha-access-control-manager"))
    if path.startswith("/"):
        path = path[1:]

    hass.async_create_task(
        async_register_panel(
            hass,
            frontend_url_path=path,
            webcomponent_name="access-control-manager",
            module_url="/local/community/ha-access-control-manager/ha-access-control-manager.js",
            sidebar_title=tab_name,
            sidebar_icon=tab_icon,
            require_admin=True,
        )
    )

    return True


async def async_unload_entry(hass: HomeAssistant, config_entry: ConfigEntry):
    """Unload a config entry."""
    path = config_entry.options.get("path", config_entry.data.get("path", "/ha-access-control-manager"))
    if path.startswith("/"):
        path = path[1:]


    path = "ha_access_control_manager"
    
    path = "ha_access_control_manager"
    panels = hass.data.get("frontend_panels", {})
    if path in panels:
        hass.components.frontend.async_remove_panel(path)
    return True

async def async_copy_file(source_path, dest_path):
    async with aiofiles.open(source_path, 'rb') as src, aiofiles.open(dest_path, 'wb') as dst:
        while chunk := await src.read(1024):  # Adjust chunk size as needed
            await dst.write(chunk)