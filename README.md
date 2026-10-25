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

## Group visibility card

The optional **ACM Group Card** wraps one Lovelace card and shows it when the
signed-in user belongs to **at least one** selected ACM group. A native vertical
or horizontal stack can be the wrapped card when you need several cards.
Membership is read using the browser's authenticated Home Assistant connection;
there is no shared "current user" sensor and no Home Assistant Core override.

> **Visibility is not security.** This card does not change entity permissions or
> block direct access to Home Assistant APIs, dashboards, history, or statistics.
> In particular, it does not fix the statistics-access behavior reported in
> [issue #60](https://github.com/Darkdragon14/ha-access-control-manager/issues/60).

### Install the resource

1. Update/install ACM and restart Home Assistant. ACM copies the card and its
   editor to `/config/www/community/ha-access-control-manager/` at startup.
2. Enable **Advanced mode** in your profile if the resource menu is not visible.
3. Under **Settings → Dashboards → Resources**, add this JavaScript module:
   `/local/community/ha-access-control-manager/acm-group-card.js?v=1`.
4. Reload the browser. After an update, change the `v` query parameter (for
   example, to `v=2`) to refresh both the card and its lazy-loaded editor.

For YAML-managed resources, add it to your `configuration.yaml` instead:

```yaml
lovelace:
  resources:
    - url: /local/community/ha-access-control-manager/acm-group-card.js?v=1
      type: module
```

Keep both JavaScript files together in the installed directory. Only the main
card needs a resource entry; it loads `acm-group-card-editor.js` automatically.
Resource registration is manual; ACM does not rewrite dashboard configuration.

### Configure in Lovelace

As an administrator, edit your dashboard and add **ACM Group Card**:

1. Check the groups allowed to see the content. The editor displays names and IDs.
2. Use the native card picker to select the wrapped card.
3. Configure that card using its usual editor, including its YAML mode if needed.
4. To show multiple cards, choose a native stack and configure its children there.

The wrapper has **one** `card`, not its own `cards` or layout option. You can
replace or remove that card without changing the selected groups. Opening the
editor does not automatically change your saved configuration.

The group catalog is administrator-only. At runtime, other users can retrieve
only their own current groups, not other users, memberships, or permission policies.

### YAML examples

```yaml
type: custom:acm-group-card
groups:
  - custom-group-bureau
  - custom-group-bar
card:
  type: entities
  entities:
    - switch.bar_kuhltheke_steuerung
```

Use a native stack for multiple cards:

```yaml
type: custom:acm-group-card
groups:
  - custom-group-bureau
card:
  type: vertical-stack
  cards:
    - type: markdown
      content: Club management
    - type: entities
      entities:
        - switch.bar_kuhltheke_steuerung
```

The examples use illustrative group/entity IDs. Select your groups in the visual
editor to obtain their actual IDs; YAML uses IDs rather than display names.

### Behavior and troubleshooting

- **No administrator bypass:** even an administrator/owner must belong to one
  selected group. Include the `system-admin` group if administrators should see it.
  The runtime preview respects this rule too; the child editor itself can still
  instantiate previews while an administrator is configuring the card.
- **Loading and errors:** the wrapped card is not instantiated while membership
  is unknown, unavailable, or does not match. API errors clear previously cached
  groups rather than retaining an old authorization indefinitely.
- **Refresh:** visible or hidden wrappers share one membership request per
  connection and user. Groups refresh every 60 seconds while wrappers are present,
  on reconnection, and when the browser tab returns to the foreground. Each request
  times out after 15 seconds. Background-tab throttling can delay periodic refresh.
- **Rename/delete:** ACM currently changes a group's ID when renaming it. Reselect
  renamed groups in affected cards. Deleted/unknown IDs authorize nobody and are
  preserved with a warning in the editor until you remove them.
- **Configuration errors:** select at least one group and configure a child card.
  If nobody matches, the card is hidden; incomplete configuration is not permissive.
- **Missing card/editor:** check the resource URL, module type, both installed files,
  browser cache, and whether ACM is loaded. The editor provides retry buttons for
  group-catalog and native-editor loading failures. Third-party cards must have
  their own resources installed as usual.

### Development checks

The dependency-free unit suites use Python 3.13+ and Node.js 24:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm test
python3 -m compileall -q custom_components
git diff --check
docker run --rm -v "$PWD:/github/workspace:ro" ghcr.io/home-assistant/hassfest
```

Python unit tests stub Home Assistant dependencies; they are not a replacement
for live testing. Before shipping frontend changes, also verify the real HA
frontend with an administrator and restricted account, native/custom/stack child
cards, Sections and masonry views, mobile sizing, membership changes, and reconnects.
CI retains the existing HACS and Hassfest validations and runs both unit suites.

# Future improvements

* Adding a message to confirm or display an error when we save :rocket:

* Search system to quickly find resources :rocket:

* Adding a function to sanitize url for path_to_admin_ui :hammer_and_wrench:

* Improving error handling and code maintainability. :hammer_and_wrench:

# Missing Translation

If you want this component to support another language, feel free to submit a PR or create an issue. If you open an issue, I’ll gladly handle the translation for you! :smile:

## Contributors

See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for the full list of contributors.
