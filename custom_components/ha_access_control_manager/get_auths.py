from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .set_auths import _attach_group_dashboards, serialize_runtime_auth_data


@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_auths"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_auths(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    auth_data = await serialize_runtime_auth_data(hass)
    await _attach_group_dashboards(hass, auth_data)
    connection.send_result(msg["id"], auth_data)
