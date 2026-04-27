from typing import Any
import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.loader import IntegrationNotFound, async_get_integration

try:
    from homeassistant.helpers import label_registry as lr
except ImportError:  # pragma: no cover - older Home Assistant versions
    lr = None


async def _resolve_integration_name(
    hass: HomeAssistant, domain: str, cache: dict[str, str]
) -> str:
    """Resolve a human-readable integration name from a domain."""
    if domain in cache:
        return cache[domain]

    try:
        integration = await async_get_integration(hass, domain)
        name = integration.name
    except IntegrationNotFound:
        name = domain

    cache[domain] = name
    return name


async def _resolve_device_integrations(
    hass: HomeAssistant, config_entry_ids, cache: dict[str, str]
) -> list[dict[str, str]]:
    """Resolve integration labels from linked config entries."""
    integrations: list[dict[str, str]] = []
    seen: set[str] = set()

    for entry_id in config_entry_ids:
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is None:
            continue

        label = await _resolve_integration_name(hass, entry.domain, cache)
        if entry.domain in seen:
            continue

        seen.add(entry.domain)
        integrations.append({"domain": entry.domain, "name": label})

    return integrations


def _resolve_area_name(area_registry, area_id: str | None) -> str | None:
    """Resolve area name from area registry."""
    if not area_id:
        return None

    area_entry = area_registry.async_get_area(area_id)
    if area_entry is None:
        return None

    return area_entry.name


def _registry_value(value) -> str | None:
    """Return a JSON-compatible registry enum value."""
    if value is None:
        return None

    return getattr(value, "value", value)


def _label_entries(label_registry, label_ids) -> list[dict[str, str]]:
    """Resolve label IDs to names while keeping the ID for filtering."""
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


async def convert_device_entry(
    hass: HomeAssistant,
    area_registry,
    label_registry,
    device,
    integration_name_cache: dict[str, str],
):
    """Convertit un DeviceEntry en dictionnaire JSON-compatible."""
    integrations = await _resolve_device_integrations(
        hass, device.config_entries, integration_name_cache
    )
    integration = ", ".join(item["name"] for item in integrations) or None
    area = _resolve_area_name(area_registry, device.area_id)

    return {
        "id": device.id,
        "name": device.name or "Unknown",
        "manufacturer": device.manufacturer or "Unknown",
        "model": device.model or "Unknown",
        "identifiers": list(device.identifiers),
        "connections": list(device.connections),
        "config_entries": list(device.config_entries),
        "sw_version": device.sw_version,
        "hw_version": device.hw_version,
        "via_device_id": device.via_device_id,
        "configuration_url": device.configuration_url,
        "created_at": device.created_at.isoformat() if device.created_at else None,
        "modified_at": device.modified_at.isoformat() if device.modified_at else None,
        "entry_type": device.entry_type.value if device.entry_type else None,
        "disabled_by": _registry_value(getattr(device, "disabled_by", None)),
        "is_new": getattr(device, "is_new", False),
        "area_id": device.area_id,
        "area": area,
        "integration": integration,
        "integrations": integrations,
        "labels": _label_entries(label_registry, getattr(device, "labels", [])),
        "entities": []  # Initialisation de la liste des entités associées
    }

def convert_entity_entry(entity, area_registry, label_registry):
    """Convertit un EntityEntry en dictionnaire JSON-compatible."""
    area_id = getattr(entity, "area_id", None)

    return {
        "entity_id": entity.entity_id,
        "name": entity.name or "Unknown",
        "domain": getattr(entity, "domain", None) or entity.entity_id.split(".", 1)[0],
        "platform": entity.platform,
        "device_id": entity.device_id,  # Peut être None
        "unique_id": entity.unique_id,
        "disabled_by": _registry_value(entity.disabled_by),
        "hidden_by": _registry_value(getattr(entity, "hidden_by", None)),
        "original_name": entity.original_name,
        "area_id": area_id,
        "area": _resolve_area_name(area_registry, area_id),
        "labels": _label_entries(label_registry, getattr(entity, "labels", [])),
        "categories": dict(getattr(entity, "categories", {}) or {}),
    }

@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_devices"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_devices(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)
    area_registry = ar.async_get(hass)
    label_registry = lr.async_get(hass) if lr else None
    integration_name_cache: dict[str, str] = {}

    # Récupération des devices sous forme de dictionnaire (id -> objet JSON)
    devices = {}
    for device in device_registry.devices.values():
        devices[device.id] = await convert_device_entry(
            hass, area_registry, label_registry, device, integration_name_cache
        )

    # Initialisation du "device" fictif pour les entités sans device
    without_devices = {
        "id": "withoutDevices",
        "name": "Entities without Devices",
        "manufacturer": "Home Assistant",
        "model": "Virtual",
        "identifiers": [],
        "connections": [],
        "config_entries": [],
        "sw_version": None,
        "hw_version": None,
        "via_device_id": None,
        "configuration_url": None,
        "created_at": None,
        "modified_at": None,
        "entry_type": None,
        "is_new": False,
        "area_id": None,
        "area": None,
        "integration": None,
        "entities": []
    }

    # Récupération des entités et association aux devices
    for entity in entity_registry.entities.values():
        entity_data = convert_entity_entry(entity, area_registry, label_registry)
        device_id = entity_data["device_id"]

        if device_id and device_id in devices:
            devices[device_id]["entities"].append(entity_data)
        else:
            # Ajouter dans le device fictif si pas de device associé
            without_devices["entities"].append(entity_data)

    # Transformer le dictionnaire en liste et ajouter le device "withoutDevices" si nécessaire
    devices_list = list(devices.values())
    if without_devices["entities"]:
        devices_list.append(without_devices)

    # Envoi des données converties
    connection.send_result(msg["id"], devices_list)
