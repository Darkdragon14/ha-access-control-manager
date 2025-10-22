from typing import Any
import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from datetime import datetime

def convert_device_entry(device):
    """Convertit un DeviceEntry en dictionnaire JSON-compatible."""
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
        "is_new": getattr(device, "is_new", False),
        "entities": []  # Initialisation de la liste des entités associées
    }

def convert_entity_entry(entity):
    """Convertit un EntityEntry en dictionnaire JSON-compatible."""
    return {
        "entity_id": entity.entity_id,
        "name": entity.name or "Unknown",
        "platform": entity.platform,
        "device_id": entity.device_id,  # Peut être None
        "unique_id": entity.unique_id,
        "disabled_by": entity.disabled_by,
        "original_name": entity.original_name,
    }

@websocket_api.websocket_command({vol.Required("type"): "ha_access_control/list_devices"})
@websocket_api.require_admin
@websocket_api.async_response
async def list_devices(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)

    # Récupération des devices sous forme de dictionnaire (id -> objet JSON)
    devices = {device.id: convert_device_entry(device) for device in device_registry.devices.values()}

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
        "entities": []
    }

    # Récupération des entités et association aux devices
    for entity in entity_registry.entities.values():
        entity_data = convert_entity_entry(entity)
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
