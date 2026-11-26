"""Dashboard visibility is read and saved through Home Assistant's Lovelace storage.

Home Assistant is not installed for these tests; small stubs stand in for the
Lovelace integration and the auth manager.
"""

import copy
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

COMPONENT = Path(__file__).resolve().parents[1] / "custom_components/ha_access_control_manager"
PACKAGE = "_lovelace_dashboard_tests"


class ConfigNotFound(Exception):
    """Stand-in for homeassistant.components.lovelace.const.ConfigNotFound."""


LOVELACE_DATA = "lovelace_data_key"


class FakeLovelace:
    """Stand-in for a Lovelace dashboard config object of Home Assistant."""

    def __init__(self, mode="storage", config=None, stored=None):
        self.mode = mode
        self.config = config
        self.stored = stored
        self.saved = []

    async def async_load(self, force):
        if self.stored is None:
            raise ConfigNotFound
        return self.stored

    async def async_save(self, config):
        self.saved.append(copy.deepcopy(config))
        self.stored = config


def _stub_modules():
    voluptuous = ModuleType("voluptuous")
    voluptuous.Required = lambda key: key
    voluptuous.Optional = lambda key: key

    websocket_api = ModuleType("homeassistant.components.websocket_api")
    websocket_api.websocket_command = lambda schema: (lambda handler: handler)
    websocket_api.require_admin = lambda handler: handler
    websocket_api.async_response = lambda handler: handler
    websocket_api.ActiveConnection = object

    lovelace_const = ModuleType("homeassistant.components.lovelace.const")
    lovelace_const.LOVELACE_DATA = LOVELACE_DATA
    lovelace_const.MODE_STORAGE = "storage"
    lovelace_const.ConfigNotFound = ConfigNotFound

    core = ModuleType("homeassistant.core")
    core.HomeAssistant = object

    auth = ModuleType("homeassistant.auth")
    auth.models = ModuleType("homeassistant.auth.models")

    file_manager = ModuleType(f"{PACKAGE}.file_manager")
    file_manager.get_json_file = AsyncMock()
    file_manager.save_json_file = AsyncMock()

    package = ModuleType(PACKAGE)
    package.__path__ = [str(COMPONENT)]

    return {
        "voluptuous": voluptuous,
        "homeassistant": ModuleType("homeassistant"),
        "homeassistant.core": core,
        "homeassistant.auth": auth,
        "homeassistant.auth.models": auth.models,
        "homeassistant.components": ModuleType("homeassistant.components"),
        "homeassistant.components.websocket_api": websocket_api,
        "homeassistant.components.lovelace": ModuleType("homeassistant.components.lovelace"),
        "homeassistant.components.lovelace.const": lovelace_const,
        PACKAGE: package,
        f"{PACKAGE}.file_manager": file_manager,
    }


def load(module_names):
    """Import the given integration modules against the stubs."""
    modules = _stub_modules()
    loaded = {}
    with patch.dict(sys.modules, modules):
        for name in ("const", "lovelace_dashboards", *module_names):
            full_name = f"{PACKAGE}.{name}"
            if full_name in sys.modules:
                loaded[name] = sys.modules[full_name]
                continue
            spec = importlib.util.spec_from_file_location(full_name, COMPONENT / f"{name}.py")
            module = importlib.util.module_from_spec(spec)
            sys.modules[full_name] = module
            spec.loader.exec_module(module)
            loaded[name] = module
    loaded["file_manager"] = modules[f"{PACKAGE}.file_manager"]
    return loaded


def make_hass(dashboards, users=()):
    return SimpleNamespace(
        data={LOVELACE_DATA: SimpleNamespace(dashboards=dashboards)},
        auth=SimpleNamespace(async_get_users=AsyncMock(return_value=list(users))),
        config=SimpleNamespace(path=lambda name: f"/config/{name}"),
    )


def make_user(user_id, *group_ids):
    return SimpleNamespace(
        id=user_id,
        is_active=True,
        system_generated=False,
        groups=[SimpleNamespace(id=group_id) for group_id in group_ids],
    )


class StorageDashboardsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.module = load(())["lovelace_dashboards"]

    def test_default_and_entry_dashboards(self):
        default = FakeLovelace()
        energy = FakeLovelace(config={"id": "dashboard_energy", "title": "Energy", "url_path": "dashboard-energy"})
        yaml = FakeLovelace(mode="yaml", config={"id": "yaml", "url_path": "yaml-dash"})
        hass = make_hass({None: default, "yaml-dash": yaml, "dashboard-energy": energy})

        dashboards = self.module.get_storage_dashboards(hass)

        self.assertEqual(
            [(d.id, d.title, d.url_path) for d in dashboards],
            [("dashboard_energy", "Energy", "dashboard-energy"), ("lovelace", "Lovelace", "lovelace")],
        )
        self.assertIs(dashboards[1].lovelace, default)

    def test_dashboard_at_lovelace_path_replaces_default(self):
        default = FakeLovelace()
        replacement = FakeLovelace(config={"id": "lovelace", "title": "Home", "url_path": "lovelace"})
        hass = make_hass({None: default, "lovelace": replacement})

        dashboards = self.module.get_storage_dashboards(hass)

        self.assertEqual(len(dashboards), 1)
        self.assertIs(dashboards[0].lovelace, replacement)

    def test_without_lovelace(self):
        hass = SimpleNamespace(data={})
        self.assertEqual(self.module.get_storage_dashboards(hass), [])

    async def test_load_returns_copy_and_skips_missing_config(self):
        stored = {"views": [{"path": "home"}]}
        hass = make_hass({None: FakeLovelace(stored=stored), "empty": FakeLovelace(config={"id": "empty", "url_path": "empty"})})
        empty, default = self.module.get_storage_dashboards(hass)

        config = await default.async_load_config()
        config["views"][0]["visible"] = []
        self.assertEqual(stored, {"views": [{"path": "home"}]})
        self.assertIsNone(await empty.async_load_config())


class SyncTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        modules = load(("set_auths",))
        self.set_auths = modules["set_auths"]
        self.file_manager = modules["file_manager"]

    async def test_sync_saves_through_lovelace(self):
        default = FakeLovelace(
            stored={"views": [{"path": "home"}, {"title": "Second"}, {"path": "admin", "visible": [{"user": "old"}]}]}
        )
        energy = FakeLovelace(
            config={"id": "dashboard_energy", "url_path": "dashboard-energy"},
            stored={"views": [{"path": "power", "visible": [{"user": "anna"}]}]},
        )
        hass = make_hass(
            {None: default, "dashboard-energy": energy},
            users=[make_user("anna", "custom-group-basis"), make_user("boss", "system-admin")],
        )
        self.file_manager.get_json_file.return_value = {
            "groups": {
                "custom-group-basis": {
                    "lovelace": {"visible": True, "views": {"admin": False}},
                    "dashboard_energy": {"views": {"power": True}},
                }
            }
        }

        await self.set_auths.async_sync_group_dashboards_to_users(hass)

        self.assertEqual(len(default.saved), 1)
        views = default.saved[0]["views"]
        self.assertEqual(views[0]["visible"], [{"user": "anna"}, {"user": "boss"}])
        # A view without path or id keeps its previous id "<dashboard>-view-<index>".
        self.assertEqual(views[1]["visible"], [{"user": "anna"}, {"user": "boss"}])
        self.assertEqual(views[2]["visible"], [{"user": "boss"}])
        self.assertEqual(
            energy.saved, [{"views": [{"path": "power", "visible": [{"user": "anna"}, {"user": "boss"}]}]}]
        )
        self.file_manager.save_json_file.assert_not_awaited()

    async def test_unchanged_dashboard_is_not_saved(self):
        default = FakeLovelace(stored={"views": [{"path": "home", "visible": [{"user": "boss"}]}]})
        hass = make_hass({None: default}, users=[make_user("boss", "system-admin")])
        self.file_manager.get_json_file.return_value = {"groups": {}}

        await self.set_auths.async_sync_group_dashboards_to_users(hass)

        self.assertEqual(default.saved, [])


if __name__ == "__main__":
    unittest.main()
