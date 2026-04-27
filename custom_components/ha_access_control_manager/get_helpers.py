from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

try:
    from homeassistant.helpers import category_registry as cr
except ImportError:  # pragma: no cover - older Home Assistant versions
    cr = None

try:
    from homeassistant.helpers import label_registry as lr
except ImportError:  # pragma: no cover - older Home Assistant versions
    lr = None


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
VOICE_ASSISTANTS = {
    "conversation": "Assist",
    "cloud.alexa": "Amazon Alexa",
    "cloud.google_assistant": "Google Assistant",
}


def _registry_value(value) -> str | None:
    if value is None:
        return None

    return getattr(value, "value", value)


def _label_entries(label_registry, label_ids) -> list[dict[str, str]]:
    labels: list[dict[str, str]] = []
    for label_id in sorted(label_ids or []):
        label = label_registry.async_get_label(label_id) if label_registry else None
        labels.append(
            {
                "id": label_id,
                "name": label.name if label is not None else label_id,
            }
        )

    return labels


def _voice_assistants(entity) -> list[dict[str, str]]:
    options = getattr(entity, "options", {}) or {}
    assistants: list[dict[str, str]] = []

    for assistant_id, name in VOICE_ASSISTANTS.items():
        if options.get(assistant_id, {}).get("should_expose"):
            assistants.append({"id": assistant_id, "name": name})

    return assistants


def _resolve_device_name(device_registry, device_id: str | None) -> str | None:
    if not device_id:
        return None

    device_entry = device_registry.async_get(device_id)
    if device_entry is None:
        return None

    return getattr(device_entry, "name_by_user", None) or device_entry.name or device_entry.id


def _resolve_helper_category(category_registry, category_id: str | None) -> str | None:
    if category_registry is None:
        return None

    if not category_id:
        return None

    category = category_registry.async_get_category(
        scope="helpers", category_id=category_id
    )
    if category is None:
        return None

    return category.name


def _classify_helper(entity) -> tuple[bool, str | None]:
    domain = getattr(entity, "domain", None) or entity.entity_id.split(".", 1)[0]

    if domain == "light" and entity.platform == LIGHT_GROUP_PLATFORM:
        return True, "light_group"

    if domain in HELPER_DOMAINS:
        return True, domain

    if domain.startswith(INPUT_DOMAIN_PREFIX):
        return True, domain

    return False, None


def _convert_helper_entity(
    entity, helper_type: str, label_registry, category_registry
) -> dict[str, Any]:
    area_id = getattr(entity, "area_id", None)
    categories = dict(getattr(entity, "categories", {}) or {})
    category_id = categories.get("helpers")

    return {
        "entity_id": entity.entity_id,
        "name": entity.name or entity.original_name or entity.entity_id,
        "original_name": entity.original_name,
        "platform": entity.platform,
        "domain": getattr(entity, "domain", None) or entity.entity_id.split(".", 1)[0],
        "helper_type": helper_type,
        "device_id": entity.device_id,
        "area_id": area_id,
        "disabled_by": _registry_value(getattr(entity, "disabled_by", None)),
        "hidden_by": _registry_value(getattr(entity, "hidden_by", None)),
        "labels": _label_entries(label_registry, getattr(entity, "labels", [])),
        "categories": categories,
        "category_id": category_id,
        "category_name": _resolve_helper_category(category_registry, category_id),
        "voice_assistants": _voice_assistants(entity),
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
    label_registry = lr.async_get(hass) if lr else None
    category_registry = cr.async_get(hass) if cr else None

    helpers: list[dict[str, Any]] = []
    for entity in entity_registry.entities.values():
        is_helper, helper_type = _classify_helper(entity)
        if not is_helper or helper_type is None:
            continue

        helper = _convert_helper_entity(
            entity, helper_type, label_registry, category_registry
        )
        helper["area"] = _resolve_helper_area(area_registry, device_registry, helper)
        helper["device_name"] = _resolve_device_name(device_registry, entity.device_id)
        helpers.append(helper)

    connection.send_result(msg["id"], helpers)
