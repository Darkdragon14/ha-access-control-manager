"""Group command unit tests with no Home Assistant dependencies installed.

The small WebSocket stubs model schema validation and admin dispatch. These
tests check our decorators and handlers, not Home Assistant's implementation.
"""

import importlib.util
from functools import wraps
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


def load_group_commands():
    """Import only the task module, without running integration setup."""
    voluptuous = ModuleType("voluptuous")
    voluptuous.Required = lambda key: key
    websocket_api = ModuleType("homeassistant.components.websocket_api")

    def websocket_command(schema):
        def decorate(handler):
            @wraps(handler)
            async def dispatch(hass, connection, msg):
                if set(msg) != {"id", *schema}:
                    raise ValueError("Unexpected or missing command fields")
                if msg["type"] != schema["type"]:
                    raise ValueError("Unexpected command type")
                await handler(hass, connection, msg)

            dispatch.command_schema = schema
            return dispatch

        return decorate

    def require_admin(handler):
        @wraps(handler)
        async def dispatch(hass, connection, msg):
            if connection.user is None or not connection.user.is_admin:
                connection.send_error(msg["id"], "unauthorized", "Admin required.")
                return
            await handler(hass, connection, msg)

        dispatch.admin_required = True
        return dispatch

    def async_response(handler):
        handler.async_response = True
        return handler

    websocket_api.websocket_command = websocket_command
    websocket_api.require_admin = require_admin
    websocket_api.async_response = async_response
    websocket_api.ActiveConnection = object
    core = ModuleType("homeassistant.core")
    core.HomeAssistant = object
    package_name = "_group_command_tests"
    package = ModuleType(package_name)
    package.__path__ = []
    set_auths = ModuleType(f"{package_name}.set_auths")
    set_auths._get_auth_store = Mock(side_effect=lambda hass: hass.auth._store)
    modules = {
        "voluptuous": voluptuous,
        "homeassistant": ModuleType("homeassistant"),
        "homeassistant.core": core,
        "homeassistant.components": ModuleType("homeassistant.components"),
        "homeassistant.components.websocket_api": websocket_api,
        package_name: package,
        f"{package_name}.set_auths": set_auths,
    }
    path = (
        Path(__file__).resolve().parents[1]
        / "custom_components/ha_access_control_manager/get_groups.py"
    )
    spec = importlib.util.spec_from_file_location(f"{package_name}.get_groups", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


def group(group_id, name):
    return SimpleNamespace(
        id=group_id, name=name, policy={"private": True}, members=["secret-user"]
    )


def user(user_id="self", *, active=True, admin=False, groups=()):
    return SimpleNamespace(
        id=user_id, is_active=active, is_admin=admin, groups=list(groups)
    )


class GroupCommandsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.commands = load_group_commands()
        self.connection = SimpleNamespace(
            user=user(), send_result=Mock(), send_error=Mock()
        )
        self.auth = SimpleNamespace(
            async_get_user=AsyncMock(return_value=user()),
            async_get_users=AsyncMock(),
            _store=SimpleNamespace(_groups={}),
        )
        self.hass = SimpleNamespace(auth=self.auth)
        self.self_msg = {"id": 1, "type": "ha_access_control/current_user_groups"}
        self.catalog_msg = {"id": 2, "type": "ha_access_control/list_groups"}

    def test_decorated_command_metadata(self):
        current = self.commands.current_user_groups
        catalog = self.commands.list_groups
        self.assertEqual(current.command_schema, {"type": self.self_msg["type"]})
        self.assertEqual(catalog.command_schema, {"type": self.catalog_msg["type"]})
        self.assertTrue(current.async_response)
        self.assertTrue(catalog.async_response)
        self.assertFalse(getattr(current, "admin_required", False))
        self.assertTrue(catalog.admin_required)

    async def test_non_admin_gets_only_fresh_own_groups(self):
        self.connection.user.groups = [group("stale", "Stale group")]
        self.auth.async_get_user.return_value = user(
            groups=[group("fresh", "Fresh group")]
        )
        await self.commands.current_user_groups(self.hass, self.connection, self.self_msg)
        self.auth.async_get_user.assert_awaited_once_with("self")
        self.auth.async_get_users.assert_not_awaited()
        self.commands._get_auth_store.assert_not_called()
        self.connection.send_result.assert_called_once_with(
            1, {"groups": [{"id": "fresh", "name": "Fresh group"}]}
        )
        self.connection.send_error.assert_not_called()

    async def test_membership_is_reread_on_each_request(self):
        self.auth.async_get_user.side_effect = [
            user(groups=[group("old", "Old")]),
            user(groups=[group("new", "New")]),
        ]
        await self.commands.current_user_groups(self.hass, self.connection, self.self_msg)
        await self.commands.current_user_groups(self.hass, self.connection, self.self_msg)
        self.assertEqual(self.auth.async_get_user.await_count, 2)
        self.assertEqual(
            self.connection.send_result.call_args.args,
            (1, {"groups": [{"id": "new", "name": "New"}]}),
        )

    async def test_active_user_without_groups_gets_empty_list(self):
        await self.commands.current_user_groups(self.hass, self.connection, self.self_msg)
        self.connection.send_result.assert_called_once_with(1, {"groups": []})

    async def test_missing_connection_user_fails_closed(self):
        self.connection.user = None
        await self.commands.current_user_groups(self.hass, self.connection, self.self_msg)
        self.auth.async_get_user.assert_not_awaited()
        self.connection.send_result.assert_not_called()
        self.connection.send_error.assert_called_once_with(
            1, "unauthorized", "Active user required."
        )

    async def test_missing_or_inactive_refreshed_user_fails_closed(self):
        for refreshed_user in (None, user(active=False)):
            with self.subTest(user=refreshed_user):
                self.connection.send_error.reset_mock()
                self.auth.async_get_user.return_value = refreshed_user
                await self.commands.current_user_groups(
                    self.hass, self.connection, self.self_msg
                )
                self.connection.send_result.assert_not_called()
                self.connection.send_error.assert_called_once_with(
                    1, "unauthorized", "Active user required."
                )

    async def test_user_id_and_other_extra_arguments_are_rejected(self):
        for handler, msg in (
            (self.commands.current_user_groups, self.self_msg),
            (self.commands.list_groups, self.catalog_msg),
        ):
            for extra in ("user_id", "id_of_user", "groups"):
                with self.subTest(command=msg["type"], extra=extra):
                    with self.assertRaises(ValueError):
                        await handler(self.hass, self.connection, {**msg, extra: "other"})
        self.auth.async_get_user.assert_not_awaited()
        self.connection.send_result.assert_not_called()

    async def test_handler_never_uses_supplied_user_id(self):
        # Even bypassing schema dispatch cannot make the handler query another user.
        await self.commands.current_user_groups.__wrapped__(
            self.hass, self.connection, {**self.self_msg, "user_id": "victim"}
        )
        self.auth.async_get_user.assert_awaited_once_with("self")

    async def test_non_admin_cannot_read_catalog(self):
        await self.commands.list_groups(self.hass, self.connection, self.catalog_msg)
        self.connection.send_result.assert_not_called()
        self.connection.send_error.assert_called_once()
        self.commands._get_auth_store.assert_not_called()

    async def test_admin_catalog_includes_unassigned_and_system_groups(self):
        self.connection.user = user(admin=True)
        self.auth._store._groups = {
            "system-admin": group("system-admin", "Administrators"),
            "unassigned": group("unassigned", "Unassigned"),
        }
        await self.commands.list_groups(self.hass, self.connection, self.catalog_msg)
        self.commands._get_auth_store.assert_called_once_with(self.hass)
        self.auth.async_get_users.assert_not_awaited()
        self.auth.async_get_user.assert_not_awaited()
        self.connection.send_result.assert_called_once_with(
            2,
            {
                "groups": [
                    {"id": "system-admin", "name": "Administrators"},
                    {"id": "unassigned", "name": "Unassigned"},
                ]
            },
        )
        self.connection.send_error.assert_not_called()

    async def test_empty_admin_catalog(self):
        self.connection.user = user(admin=True)
        await self.commands.list_groups(self.hass, self.connection, self.catalog_msg)
        self.connection.send_result.assert_called_once_with(2, {"groups": []})

    async def test_unnamed_groups_have_a_usable_display_name(self):
        self.auth.async_get_user.return_value = user(groups=[group("legacy", None)])
        await self.commands.current_user_groups(self.hass, self.connection, self.self_msg)
        self.connection.send_result.assert_called_once_with(
            1, {"groups": [{"id": "legacy", "name": "legacy"}]}
        )


if __name__ == "__main__":
    unittest.main()
