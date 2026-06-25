# Access Control Manager For Home Assistant
[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![HA integration usage](https://img.shields.io/badge/dynamic/json?color=41BDF5&logo=home-assistant&label=integration%20usage&suffix=%20installs&cacheSeconds=15600&url=https://analytics.home-assistant.io/custom_integrations.json&query=$.ha_access_control_manager.total)](https://analytics.home-assistant.io/custom_integrations.json)
[![Hassfest](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hassfest.yml/badge.svg)](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hassfest.yml)
[![HACS Action](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hacs_action.yml/badge.svg)](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hacs_action.yml)
[![release](https://img.shields.io/github/v/release/Darkdragon14/ha-access-control-manager.svg)](https://github.com/Darkdragon14/ha-access-control-manager/releases)

"Access Control Manager" provides a centralized interface for managing user permissions and access rights within Home Assistant. It allows administrators to create, assign, and customize roles, ensuring secure and streamlined control over who can interact with specific devices, automations, and dashboards in the smart home ecosystem.

# Installation

## HACS installation

[![Open your Home Assistant instance and open a repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Darkdragon14&repository=ha-access-control-manager)

To install Access Control Manager using [HACS](https://hacs.xyz/):

1. Click the button above, or add this repository manually as a custom repository in HACS:
   - Go to **HACS** → **Integrations** → **Add Custom Repository**.
   - Enter the URL of this repository and select **Integration** as the category.
2. Search for "Access Control Manager" in HACS and install it.
3. Restart Home Assistant.
4. Go to **Settings** → **Devices & Services** → **Add Integration**.
5. Search for "Access Control Manager" and select it.

# How it works

This section was added following [this issue](https://github.com/Darkdragon14/ha-access-control-manager/issues/13).

To set up custom access management, you need to follow these steps:

1.  **Create a new group**: Define a new group that will have specific permissions.
2.  **Unassign the `Users` group**: For the users you want to restrict, you must remove them from the default `Users` group. As explained in the [Home Assistant developer documentation](https://developers.home-assistant.io/docs/auth_permissions/#merging-policies), policies are merged, and the `Users` group grants broad permissions by default. To apply restrictive policies, the user must not be a member of the `Users` group.
3.  **Set permissions**: Assign the desired permissions to the new group you have created.

## Label permissions

The **Label permissions** section is a bulk-edit helper for entities, helpers, and devices that directly use a Home Assistant label. When you select read or write for a label, Access Control Manager applies that permission to the currently loaded matching entities and saves them as individual entity permissions.

This does not create a persistent Home Assistant label policy. If you add a new device or entity later and assign the same label to it, the new item will not automatically receive those permissions. Reopen the group permissions, apply the label permission again, and save to include new matching items.

## Customizable options

|Option Name|Description|required|default Value|
|---|---|---|---|
|**Tab Icon**|Icon for the Access Control Manager tab, chosen from 23 MDI icons|No|`mdi:shield-account`|
|**Tab Name**|Name of the Access Control Manager tab.|No|`Access Control Manager`|
|**Path for Admin UI**|Custom URL path for accessing the admin interface|No|`/ha-access-control-manager`|

## Public API: dashboard visibility sync

Access Control Manager exposes an async helper that other Home Assistant code can call to synchronize Lovelace dashboard visibility from the current ACM group dashboard permissions.

The helper is registered in `hass.data` when the integration is loaded:

```python
from homeassistant.core import HomeAssistant

ACM_DOMAIN = "ha_access_control_manager"
SYNC_DASHBOARDS_API = "async_sync_group_dashboards_to_users"


async def async_update_dashboard_visibility(hass: HomeAssistant) -> None:
    sync_dashboards = hass.data.get(ACM_DOMAIN, {}).get(SYNC_DASHBOARDS_API)
    if sync_dashboards is None:
        raise RuntimeError("Access Control Manager is not loaded")

    await sync_dashboards(hass)
```

This coroutine must be awaited from Home Assistant's event loop. It does not take a user or group argument; it syncs dashboard visibility for users based on the saved ACM group dashboard permissions.

# Future improvements

* Adding a message to confirm or display an error when we save :rocket:

* Search system to quickly find resources :rocket:

* Adding a function to sanitize url for path_to_admin_ui :hammer_and_wrench:

* Improving error handling and code maintainability. :hammer_and_wrench:

# Missing Translation

If you want this component to support another language, feel free to submit a PR or create an issue. If you open an issue, I’ll gladly handle the translation for you! :smile:

## Contributors

See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for the full list of contributors.
