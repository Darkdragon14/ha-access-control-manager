import copy
import os
import re
from typing import Any
import unicodedata

import voluptuous as vol

from homeassistant.auth import models as auth_models
from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

from .file_manager import get_json_file, save_json_file
from .const import (
    AUTH_PATH,
    NEW_AUTH_PATH,
    GROUP_DASHBOARD_PERMISSIONS_PATH,
    LOVELACE_DASHBOARDS_PATH,
    LOVELACE_STORAGE_DIR,
    LOVELACE_STORAGE,
    LOVELACE_STORAGE_PREFIX,
    SYSTEM_GROUP_IDS,
)

SYSTEM_GROUPS_WITH_FULL_DASHBOARD_ACCESS = {"system-admin", "system-users"}


def _build_default_group_policy() -> dict[str, Any]:
    return {"entities": {"entity_ids": {}}}


def _get_auth_store(hass: HomeAssistant) -> Any:
    auth_store = getattr(getattr(hass, "auth", None), "_store", None)
    if auth_store is None:
        raise RuntimeError("Auth store is not available")

    return auth_store


async def _persist_auth_store(hass: HomeAssistant) -> None:
    auth_store = _get_auth_store(hass)
    await auth_store._store.async_save(auth_store._data_to_save())


async def serialize_runtime_auth_data(hass: HomeAssistant) -> dict[str, Any]:
    auth_store = _get_auth_store(hass)

    groups = []
    for group in auth_store._groups.values():
        group_data = {
            "id": group.id,
            "name": group.name,
            "system_generated": group.system_generated,
        }
        if not group.system_generated:
            group_data["policy"] = copy.deepcopy(group.policy)
        groups.append(group_data)

    users = []
    for user in await hass.auth.async_get_users():
        users.append(
            {
                "id": user.id,
                "name": user.name,
                "group_ids": _normalize_group_ids([group.id for group in user.groups]),
                "is_owner": user.is_owner,
                "is_active": user.is_active,
                "system_generated": user.system_generated,
                "local_only": getattr(user, "local_only", False),
            }
        )

    return {
        "groups": groups,
        "users": users,
    }


async def _build_auth_response_data(hass: HomeAssistant) -> dict[str, Any]:
    auth_data = await serialize_runtime_auth_data(hass)
    await _attach_group_dashboards(hass, auth_data)
    return auth_data


async def _load_legacy_auth_payloads(hass: HomeAssistant) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []

    for relative_path in (NEW_AUTH_PATH, AUTH_PATH):
        absolute_path = hass.config.path(relative_path)
        if not os.path.exists(absolute_path):
            continue

        legacy_data = await get_json_file(absolute_path)
        if not isinstance(legacy_data, dict):
            continue

        payload = legacy_data.get("data") if isinstance(legacy_data.get("data"), dict) else legacy_data
        if not isinstance(payload, dict):
            continue

        payloads.append(payload)

    return payloads


async def migrate_legacy_auth_data(hass: HomeAssistant) -> None:
    auth_store = _get_auth_store(hass)
    legacy_payloads = await _load_legacy_auth_payloads(hass)
    if not legacy_payloads:
        return

    runtime_group_ids = set(auth_store._groups)
    changed = False

    for payload in legacy_payloads:
        groups = payload.get("groups")
        if not isinstance(groups, list):
            continue

        for group in groups:
            if not isinstance(group, dict):
                continue

            group_id = group.get("id")
            if not isinstance(group_id, str) or not group_id or group_id in runtime_group_ids:
                continue

            if group_id in SYSTEM_GROUP_IDS:
                continue

            policy = group.get("policy")
            if not isinstance(policy, dict):
                policy = _build_default_group_policy()

            auth_store._groups[group_id] = auth_models.Group(
                id=group_id,
                name=group.get("name"),
                policy=copy.deepcopy(policy),
                system_generated=False,
            )
            runtime_group_ids.add(group_id)
            changed = True

    runtime_users = {user.id: user for user in await hass.auth.async_get_users()}
    for payload in legacy_payloads:
        users = payload.get("users")
        if not isinstance(users, list):
            continue

        for user_data in users:
            if not isinstance(user_data, dict):
                continue

            user_id = user_data.get("id")
            if not isinstance(user_id, str) or not user_id:
                continue

            user = runtime_users.get(user_id)
            if user is None:
                continue

            current_group_ids = _normalize_group_ids([group.id for group in user.groups])
            migrated_group_ids = [
                group_id
                for group_id in _normalize_group_ids(user_data.get("group_ids"))
                if group_id in runtime_group_ids
            ]
            merged_group_ids = _normalize_group_ids(current_group_ids + migrated_group_ids)
            if merged_group_ids == current_group_ids:
                continue

            await hass.auth.async_update_user(user, group_ids=merged_group_ids)
            changed = True

    if changed:
        await _persist_auth_store(hass)
        await _sync_group_dashboards_to_users(hass)

    new_auth_path = hass.config.path(NEW_AUTH_PATH)
    if os.path.exists(new_auth_path):
        await hass.async_add_executor_job(os.remove, new_auth_path)


@websocket_api.websocket_command({
    vol.Required("type"): "ha_access_control/create_group",
    vol.Required("name"): str,
    vol.Optional("source_group_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def create_group(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    group_name = (msg.get("name") or "").strip()
    if not group_name:
        connection.send_error(msg["id"], "invalid_group_name", "Invalid group name.")
        return

    auth_store = _get_auth_store(hass)
    auth_data = await serialize_runtime_auth_data(hass)

    source_group_id = msg.get("source_group_id")
    source_group = None
    source_dashboards: dict[str, Any] = {}
    if isinstance(source_group_id, str) and source_group_id:
        source_group = auth_store._groups.get(source_group_id)
        if not source_group:
            connection.send_error(msg["id"], "group_not_found", "Group not found.")
            return

        if _is_protected_system_group(source_group):
            connection.send_error(msg["id"], "system_group", "System groups cannot be duplicated.")
            return

        source_dashboards = copy.deepcopy((await _load_group_dashboard_permissions(hass)).get(source_group_id, {}))

    resolved_name, group_id = _resolve_unique_group_identity(auth_data, group_name)

    policy = copy.deepcopy(source_group.policy) if source_group else _build_default_group_policy()
    auth_store._groups[group_id] = auth_models.Group(
        id=group_id,
        name=resolved_name,
        policy=policy,
        system_generated=False,
    )
    await _persist_auth_store(hass)

    if source_dashboards:
        await _save_group_dashboards(hass, group_id, source_dashboards)

    await _sync_group_dashboards_to_users(hass)
    response_data = await _build_auth_response_data(hass)
    connection.send_result(
        msg["id"],
        {
            "data": response_data,
            "group_id": group_id,
            "group_name": resolved_name,
        },
    )


@websocket_api.websocket_command({
    vol.Required("type"): "ha_access_control/rename_group",
    vol.Required("group_id"): str,
    vol.Required("new_name"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def rename_group(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    group_id = msg.get("group_id")
    new_name = (msg.get("new_name") or "").strip()
    if not isinstance(group_id, str) or not group_id:
        connection.send_error(msg["id"], "invalid_group_id", "Invalid group id.")
        return

    if not new_name:
        connection.send_error(msg["id"], "invalid_group_name", "Invalid group name.")
        return

    auth_store = _get_auth_store(hass)
    auth_data = await serialize_runtime_auth_data(hass)

    group_to_rename = auth_store._groups.get(group_id)
    if not group_to_rename:
        connection.send_error(msg["id"], "group_not_found", "Group not found.")
        return

    if _is_protected_system_group(group_to_rename):
        connection.send_error(msg["id"], "system_group", "System groups cannot be renamed.")
        return

    resolved_name, new_group_id = _resolve_unique_group_identity(
        auth_data,
        new_name,
        exclude_group_id=group_id,
    )

    group_to_rename.name = resolved_name
    if new_group_id != group_id:
        auth_store._groups.pop(group_id, None)
        group_to_rename.id = new_group_id
        auth_store._groups[new_group_id] = group_to_rename
        await _rename_group_dashboards(hass, group_id, new_group_id)

    await _persist_auth_store(hass)
    await _sync_group_dashboards_to_users(hass)
    response_data = await _build_auth_response_data(hass)
    connection.send_result(
        msg["id"],
        {
            "data": response_data,
            "old_group_id": group_id,
            "group_id": new_group_id,
            "group_name": resolved_name,
        },
    )


@websocket_api.websocket_command({
    vol.Required("type"): "ha_access_control/delete_group",
    vol.Required("group_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def delete_group(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    group_id = msg.get("group_id")
    if not isinstance(group_id, str) or not group_id:
        connection.send_error(msg["id"], "invalid_group_id", "Invalid group id.")
        return

    auth_store = _get_auth_store(hass)

    group_to_delete = auth_store._groups.get(group_id)
    if not group_to_delete:
        connection.send_error(msg["id"], "group_not_found", "Group not found.")
        return

    if _is_protected_system_group(group_to_delete):
        connection.send_error(msg["id"], "system_group", "System groups cannot be deleted.")
        return

    if await _group_has_linked_users(hass, group_id):
        connection.send_error(
            msg["id"],
            "group_has_users",
            "Group cannot be deleted while users are linked to it.",
        )
        return

    auth_store._groups.pop(group_id, None)
    await _persist_auth_store(hass)
    await _delete_group_dashboards(hass, group_id)
    await _sync_group_dashboards_to_users(hass)
    response_data = await _build_auth_response_data(hass)
    connection.send_result(msg["id"], {"data": response_data, "group_id": group_id})

@websocket_api.websocket_command({
    vol.Required("type"): "ha_access_control/set_auths",
    vol.Required("isAnUser"): bool,
    vol.Required("data"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def set_auths(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    if not isinstance(msg.get("data"), dict):
        connection.send_error(msg["id"], "invalid_payload", "Invalid auth payload.")
        return

    try:
        await save_auths(hass, msg)
    except (RuntimeError, ValueError) as err:
        connection.send_error(msg["id"], "save_error", str(err))
        return

    response_data = await _build_auth_response_data(hass)
    connection.send_result(msg["id"], response_data)


async def save_auths(hass: HomeAssistant, msg: dict[str, Any]) -> None:
    dashboards_payload_present = isinstance(msg.get("data"), dict) and "dashboards" in msg["data"]
    dashboards_payload: dict[str, Any] = {}
    if dashboards_payload_present:
        raw_dashboards = msg["data"].get("dashboards")
        if isinstance(raw_dashboards, dict):
            dashboards_payload = raw_dashboards

    sanitized_data = {k: v for k, v in msg["data"].items() if k != "dashboards"}
    entity_id = sanitized_data.get("id")
    if not isinstance(entity_id, str) or not entity_id:
        raise ValueError("Invalid auth entity id.")

    if msg["isAnUser"]:
        user = await hass.auth.async_get_user(entity_id)
        if user is None:
            raise ValueError("User not found.")

        await hass.auth.async_update_user(
            user,
            group_ids=_normalize_group_ids(sanitized_data.get("group_ids")),
        )
        await _persist_auth_store(hass)
        await _sync_group_dashboards_to_users(hass)
        return

    auth_store = _get_auth_store(hass)
    group = auth_store._groups.get(entity_id)
    if group is None:
        raise ValueError("Group not found.")

    if dashboards_payload_present:
        await _save_group_dashboards(hass, entity_id, dashboards_payload)

    if not _is_protected_system_group(group):
        raw_policy = sanitized_data.get("policy")
        group.policy = copy.deepcopy(raw_policy) if isinstance(raw_policy, dict) else _build_default_group_policy()
        await _invalidate_users_for_group(hass, entity_id)
        await _persist_auth_store(hass)

    await _sync_group_dashboards_to_users(hass)


def _find_group(groups: list[Any], group_id: str) -> dict[str, Any] | None:
    return next(
        (
            group
            for group in groups
            if isinstance(group, dict) and group.get("id") == group_id
        ),
        None,
    )


def _is_protected_system_group(group: Any) -> bool:
    if isinstance(group, dict):
        group_id = group.get("id")
        system_generated = group.get("system_generated") is True
    else:
        group_id = getattr(group, "id", None)
        system_generated = getattr(group, "system_generated", False) is True

    return (isinstance(group_id, str) and group_id in SYSTEM_GROUP_IDS) or system_generated


async def _group_has_linked_users(hass: HomeAssistant, group_id: str) -> bool:
    for user in await hass.auth.async_get_users():
        if any(group.id == group_id for group in user.groups):
            return True

    return False


def _sanitize_group_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized.lower())
    normalized = normalized.strip("-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized or "group"


def _build_custom_group_id(name: str) -> str:
    return f"custom-group-{_sanitize_group_slug(name)}"


def _resolve_unique_group_identity(
    auth_data: dict[str, Any] | None,
    desired_name: str,
    exclude_group_id: str | None = None,
) -> tuple[str, str]:
    base_name = desired_name.strip()
    groups = auth_data.get("groups") if isinstance(auth_data, dict) else []

    existing_names = {
        (group.get("name") or "").strip().lower()
        for group in groups
        if isinstance(group, dict)
        and group.get("id") != exclude_group_id
        and isinstance(group.get("name"), str)
        and group.get("name").strip()
    }
    existing_ids = {
        group.get("id")
        for group in groups
        if isinstance(group, dict)
        and group.get("id") != exclude_group_id
        and isinstance(group.get("id"), str)
        and group.get("id")
    }

    candidate_name = base_name
    counter = 2
    while True:
        candidate_id = _build_custom_group_id(candidate_name)
        if candidate_name.lower() not in existing_names and candidate_id not in existing_ids:
            return candidate_name, candidate_id

        candidate_name = f"{base_name} {counter}"
        counter += 1


async def _invalidate_users_for_group(hass: HomeAssistant, group_id: str) -> None:
    for user in await hass.auth.async_get_users():
        if any(group.id == group_id for group in user.groups):
            user.invalidate_cache()


async def _save_user_dashboards(hass: HomeAssistant, user_id: str, dashboards: dict[str, Any]) -> None:
    if not user_id or not isinstance(dashboards, dict):
        return

    dashboard_definitions = await _load_dashboard_definitions(hass)
    active_user_ids = await _load_active_user_ids(hass)
    if user_id not in active_user_ids:
        active_user_ids.append(user_id)

    for dashboard_id, dashboard_state in dashboards.items():
        if not isinstance(dashboard_id, str) or not dashboard_id:
            continue

        if not isinstance(dashboard_state, dict):
            continue

        dashboard_info = dashboard_definitions.get(dashboard_id, {})
        filename = dashboard_info.get("filename") if isinstance(dashboard_info, dict) else None
        if not isinstance(filename, str) or not filename:
            filename = LOVELACE_STORAGE if dashboard_id == "lovelace" else f"{LOVELACE_STORAGE_PREFIX}{dashboard_id}"

        storage, file_path = await _load_dashboard_storage(hass, dashboard_id, filename)
        if not isinstance(storage, dict) or not file_path:
            continue

        data = storage.get("data")
        if not isinstance(data, dict):
            continue

        config = data.get("config")
        if not isinstance(config, dict):
            continue

        views = config.get("views")
        if not isinstance(views, list):
            continue

        view_states = dashboard_state.get("views")
        dashboard_visible = dashboard_state.get("visible")
        changed = False

        for index, view in enumerate(views):
            if not isinstance(view, dict):
                continue

            view_id = _build_view_id(dashboard_id, view, index)
            target_state: bool | None = None

            if isinstance(view_states, dict) and view_id in view_states:
                target_state = view_states.get(view_id) is True
            elif isinstance(dashboard_visible, bool):
                target_state = dashboard_visible

            if target_state is None:
                continue

            if _set_user_view_visibility(view, user_id, target_state, active_user_ids):
                changed = True

        if changed:
            await save_json_file(file_path, storage)


async def _load_dashboard_definitions(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    dashboards_store = await get_json_file(hass.config.path(LOVELACE_DASHBOARDS_PATH))
    if not isinstance(dashboards_store, dict):
        return {}

    data = dashboards_store.get("data")
    if not isinstance(data, dict):
        return {}

    result: dict[str, dict[str, Any]] = {}

    items = data.get("items")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue

            dashboard_id = item.get("id")
            if not isinstance(dashboard_id, str) or not dashboard_id:
                continue

            result[dashboard_id] = item

    dashboards = data.get("dashboards")
    if isinstance(dashboards, dict):
        for dashboard_id, dashboard_info in dashboards.items():
            if not isinstance(dashboard_id, str) or not dashboard_id:
                continue

            if dashboard_id in result:
                continue

            result[dashboard_id] = dashboard_info if isinstance(dashboard_info, dict) else {}

    return result


async def _load_active_user_ids(hass: HomeAssistant) -> list[str]:
    user_ids: list[str] = []

    for user in await hass.auth.async_get_users():
        if not getattr(user, "is_active", False):
            continue

        if getattr(user, "system_generated", False):
            continue

        user_ids.append(user.id)

    return user_ids


async def _load_dashboard_storage(
    hass: HomeAssistant,
    dashboard_id: str,
    filename: str,
) -> tuple[dict[str, Any] | None, str | None]:
    candidates = [filename]
    if dashboard_id == "lovelace":
        fallback_filename = f"{LOVELACE_STORAGE_PREFIX}lovelace"
        if filename == LOVELACE_STORAGE:
            candidates = [fallback_filename, filename]
        elif fallback_filename not in candidates:
            candidates.append(fallback_filename)

    for candidate in candidates:
        file_path = hass.config.path(candidate)
        if not os.path.exists(file_path):
            continue

        storage = await get_json_file(file_path)
        if isinstance(storage, dict):
            return storage, file_path

    return None, None


def _build_view_id(dashboard_id: str, view: dict[str, Any], index: int) -> str:
    path = view.get("path")
    if isinstance(path, str) and path:
        return path

    view_id = view.get("id")
    if isinstance(view_id, str) and view_id:
        return view_id

    return f"{dashboard_id}-view-{index}"


def _set_user_view_visibility(
    view: dict[str, Any],
    user_id: str,
    target_visible: bool,
    active_user_ids: list[str],
) -> bool:
    raw_visible = view.get("visible") if "visible" in view else None

    if isinstance(raw_visible, list):
        entries = [item for item in raw_visible if isinstance(item, dict)]
        had_user = any(item.get("user") == user_id for item in entries)

        if target_visible:
            if had_user:
                return False

            entries.append({"user": user_id})
            view["visible"] = entries
            return True

        updated_entries = [item for item in entries if item.get("user") != user_id]
        if len(updated_entries) == len(entries):
            return False

        view["visible"] = updated_entries
        return True

    if target_visible:
        if raw_visible is None:
            return False

        view["visible"] = [{"user": user_id}]
        return True

    allowed_user_ids = [entry_user_id for entry_user_id in active_user_ids if entry_user_id != user_id]
    explicit_visible = [{"user": entry_user_id} for entry_user_id in allowed_user_ids]

    if isinstance(raw_visible, list) and raw_visible == explicit_visible:
        return False

    if raw_visible is None and explicit_visible == [] and "visible" in view and view.get("visible") == []:
        return False

    view["visible"] = explicit_visible
    return True


async def _save_group_dashboards(hass: HomeAssistant, group_id: str, dashboards: dict[str, Any]) -> None:
    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path) or {}

    if not isinstance(dashboards_store, dict):
        dashboards_store = {}

    groups = dashboards_store.get("groups")
    if not isinstance(groups, dict):
        groups = {}

    groups[group_id] = dashboards
    dashboards_store["groups"] = groups

    await save_json_file(file_path, dashboards_store)


async def _rename_group_dashboards(
    hass: HomeAssistant,
    old_group_id: str,
    new_group_id: str,
) -> None:
    if old_group_id == new_group_id:
        return

    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path)
    if not isinstance(dashboards_store, dict):
        return

    groups = dashboards_store.get("groups")
    if not isinstance(groups, dict) or old_group_id not in groups:
        return

    groups[new_group_id] = groups.pop(old_group_id)
    dashboards_store["groups"] = groups
    await save_json_file(file_path, dashboards_store)


async def _delete_group_dashboards(hass: HomeAssistant, group_id: str) -> None:
    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path)
    if not isinstance(dashboards_store, dict):
        return

    groups = dashboards_store.get("groups")
    if not isinstance(groups, dict) or group_id not in groups:
        return

    groups.pop(group_id, None)
    dashboards_store["groups"] = groups
    await save_json_file(file_path, dashboards_store)


async def _load_group_dashboard_permissions(hass: HomeAssistant) -> dict[str, Any]:
    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path)
    if not isinstance(dashboards_store, dict):
        return {}

    groups = dashboards_store.get("groups")
    return groups if isinstance(groups, dict) else {}


def _normalize_group_ids(group_ids: Any) -> list[str]:
    if not isinstance(group_ids, list):
        return []

    normalized_group_ids = [group_id for group_id in group_ids if isinstance(group_id, str) and group_id]
    return list(dict.fromkeys(normalized_group_ids))


async def _load_runtime_user_group_ids(hass: HomeAssistant) -> dict[str, list[str]]:
    user_group_ids: dict[str, list[str]] = {}

    for user in await hass.auth.async_get_users():
        if not getattr(user, "is_active", False):
            continue

        if getattr(user, "system_generated", False):
            continue

        groups = getattr(user, "groups", [])
        group_ids = [
            group.id
            for group in groups
            if isinstance(getattr(group, "id", None), str) and group.id
        ]
        user_group_ids[user.id] = _normalize_group_ids(group_ids)

    return user_group_ids


def _is_group_view_visible(
    group_dashboards: dict[str, Any] | None,
    dashboard_id: str,
    view_id: str,
) -> bool:
    if not isinstance(group_dashboards, dict):
        return False

    dashboard_state = group_dashboards.get(dashboard_id)
    if not isinstance(dashboard_state, dict):
        return False

    view_states = dashboard_state.get("views")
    if isinstance(view_states, dict) and view_id in view_states:
        return view_states.get(view_id) is True

    return dashboard_state.get("visible") is True


def _resolve_allowed_user_ids_for_view(
    user_group_ids: dict[str, list[str]],
    dashboards_map: dict[str, Any],
    dashboard_id: str,
    view_id: str,
) -> list[str]:
    allowed_user_ids: list[str] = []

    for user_id, group_ids in user_group_ids.items():
        normalized_group_ids = _normalize_group_ids(group_ids)
        if any(group_id in SYSTEM_GROUPS_WITH_FULL_DASHBOARD_ACCESS for group_id in normalized_group_ids):
            allowed_user_ids.append(user_id)
            continue

        if any(
            _is_group_view_visible(dashboards_map.get(group_id), dashboard_id, view_id)
            for group_id in normalized_group_ids
        ):
            allowed_user_ids.append(user_id)

    return allowed_user_ids


def _set_view_visible_users(view: dict[str, Any], allowed_user_ids: list[str]) -> bool:
    raw_visible = view.get("visible") if "visible" in view else None
    preserved_entries: list[Any] = []

    if isinstance(raw_visible, list):
        for entry in raw_visible:
            if not isinstance(entry, dict) or "user" not in entry:
                preserved_entries.append(entry)

    visible_entries = [{"user": user_id} for user_id in allowed_user_ids]
    new_visible = visible_entries + preserved_entries

    if isinstance(raw_visible, list) and raw_visible == new_visible:
        return False

    view["visible"] = new_visible
    return True


async def _collect_dashboard_targets(hass: HomeAssistant) -> list[tuple[str, str]]:
    dashboard_definitions = await _load_dashboard_definitions(hass)
    targets: dict[str, str] = {"lovelace": LOVELACE_STORAGE}

    for dashboard_id, dashboard_info in dashboard_definitions.items():
        if not isinstance(dashboard_id, str) or not dashboard_id:
            continue

        filename = dashboard_info.get("filename") if isinstance(dashboard_info, dict) else None
        if not isinstance(filename, str) or not filename:
            filename = LOVELACE_STORAGE if dashboard_id == "lovelace" else f"{LOVELACE_STORAGE_PREFIX}{dashboard_id}"

        targets[dashboard_id] = filename

    try:
        storage_files = await hass.async_add_executor_job(
            os.listdir,
            hass.config.path(LOVELACE_STORAGE_DIR),
        )
    except FileNotFoundError:
        storage_files = []

    for filename in storage_files:
        if not filename.startswith("lovelace."):
            continue

        dashboard_id = filename[len("lovelace.") :]
        if not dashboard_id or dashboard_id in targets:
            continue

        targets[dashboard_id] = f"{LOVELACE_STORAGE_PREFIX}{dashboard_id}"

    return list(targets.items())


async def _sync_group_dashboards_to_users(hass: HomeAssistant) -> None:
    user_group_ids = await _load_runtime_user_group_ids(hass)
    if not user_group_ids:
        return

    dashboards_map = await _load_group_dashboard_permissions(hass)
    dashboard_targets = await _collect_dashboard_targets(hass)

    for dashboard_id, filename in dashboard_targets:
        storage, file_path = await _load_dashboard_storage(hass, dashboard_id, filename)
        if not isinstance(storage, dict) or not file_path:
            continue

        data = storage.get("data")
        if not isinstance(data, dict):
            continue

        config = data.get("config")
        if not isinstance(config, dict):
            continue

        views = config.get("views")
        if not isinstance(views, list):
            continue

        changed = False
        for index, view in enumerate(views):
            if not isinstance(view, dict):
                continue

            view_id = _build_view_id(dashboard_id, view, index)
            allowed_user_ids = _resolve_allowed_user_ids_for_view(
                user_group_ids,
                dashboards_map,
                dashboard_id,
                view_id,
            )

            if _set_view_visible_users(view, allowed_user_ids):
                changed = True

        if changed:
            await save_json_file(file_path, storage)


async def _attach_group_dashboards(hass: HomeAssistant, auth_data: dict[str, Any] | None) -> None:
    if not isinstance(auth_data, dict):
        return

    groups = auth_data.get("groups")
    if not isinstance(groups, list):
        return

    file_path = hass.config.path(GROUP_DASHBOARD_PERMISSIONS_PATH)
    dashboards_store = await get_json_file(file_path) or {}
    dashboards_map = dashboards_store.get("groups")
    if not isinstance(dashboards_map, dict):
        dashboards_map = {}

    for group in groups:
        if not isinstance(group, dict):
            continue
        group_id = group.get("id")
        if not group_id:
            continue
        group["dashboards"] = dashboards_map.get(group_id, {})
