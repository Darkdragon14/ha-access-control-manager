import voluptuous as vol
from homeassistant import config_entries

from .const import ICONS 

class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handle options flow for Access Control Manager."""

    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        if user_input is not None:
            self.hass.config_entries.async_update_entry(
                self.config_entry, options=user_input
            )
            await self.hass.config_entries.async_reload(self.config_entry.entry_id)
            return self.async_create_entry(title="Access Control Manager", data=self.config_entry.options)

        tab_icon = self.config_entry.options.get("tab_icon", self.config_entry.data.get("tab_icon", "mdi:shield-account"))
        tab_name = self.config_entry.options.get("tab_name", self.config_entry.data.get("tab_name", "Access Control Manager"))
        path = self.config_entry.options.get("path", self.config_entry.data.get("path", "/ha-access-control-manager"))
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Optional("tab_icon", default=tab_icon): vol.In(ICONS),
                vol.Optional("tab_name", default=tab_name): str,
                vol.Optional("path", default=path): str,
            }),
        )