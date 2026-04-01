from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er


HELPER_DOMAINS = {
    "schedule",
    "timer",
    "counter",
    "todo",
    "calendar",
    "template",
}
INPUT_DOMAIN_PREFIX = "input_"
LIGHT_GROUP_PLATFORM = "group"


def _classify_helper(entity) -> tuple[bool, str | None]:
    domain = getattr(entity, "domain", None) or entity.entity_id.split(".", 1)[0]

    if domain == "light" and entity.platform == LIGHT_GROUP_PLATFORM:
        return True, "light_group"

    if domain in HELPER_DOMAINS:
        return True, domain

    if domain.startswith(INPUT_DOMAIN_PREFIX):
        return True, domain

    return False, None


def _convert_helper_entity(entity, helper_type: str) -> dict[str, Any]:
    area_id = getattr(entity, "area_id", None)

    return {
        "entity_id": entity.entity_id,
        "name": entity.name or entity.original_name or entity.entity_id,
        "platform": entity.platform,
        "domain": getattr(entity, "domain", None) or entity.entity_id.split(".", 1)[0],
        "helper_type": helper_type,
        "device_id": entity.device_id,
        "area_id": area_id,
    }


def _resolve_helper_area(
    area_registry, device_registry, helper: dict[str, Any]
) -> str | None:
    area_id = helper.get("area_id")

    if not area_id:
        device_id = helper.get("device_id")
        if device_id:
            device_entry = device_registry.async_get(device_id)
            if device_entry is not None:
                area_id = device_entry.area_id

    if not area_id:
        return None

    area_entry = area_registry.async_get_area(area_id)
    if area_entry is None:
        return None

    return area_entry.name


@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_helpers"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_helpers(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)
    area_registry = ar.async_get(hass)

    helpers: list[dict[str, Any]] = []
    for entity in entity_registry.entities.values():
        is_helper, helper_type = _classify_helper(entity)
        if not is_helper or helper_type is None:
            continue

        helper = _convert_helper_entity(entity, helper_type)
        helper["area"] = _resolve_helper_area(area_registry, device_registry, helper)
        helpers.append(helper)

    connection.send_result(msg["id"], helpers)
