from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .set_auths import _get_auth_store


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_access_control/current_user_groups"}
)
@websocket_api.async_response
async def current_user_groups(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return only the authenticated user's current group identities."""
    connection_user = connection.user
    if connection_user is None:
        connection.send_error(msg["id"], "unauthorized", "Active user required.")
        return

    user = await hass.auth.async_get_user(connection_user.id)
    if user is None or not user.is_active:
        connection.send_error(msg["id"], "unauthorized", "Active user required.")
        return

    connection.send_result(
        msg["id"],
        {"groups": [{"id": group.id, "name": group.name or group.id} for group in user.groups]},
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_access_control/list_groups"}
)
@websocket_api.require_admin
@websocket_api.async_response
async def list_groups(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the admin-only group catalog, without policies or membership."""
    auth_store = _get_auth_store(hass)
    connection.send_result(
        msg["id"],
        {
            "groups": [
                {"id": group.id, "name": group.name or group.id}
                for group in auth_store._groups.values()
            ]
        },
    )
