from typing import Any
import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_entities"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_entities(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    entities = [] = [] 
    for entity in hass.states.async_all():
        entities.append(entity)
    connection.send_result(msg["id"], entities)