# Access Control Manager For Home Assistant
[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![HA integration usage](https://img.shields.io/badge/dynamic/json?color=41BDF5&logo=home-assistant&label=integration%20usage&suffix=%20installs&cacheSeconds=15600&url=https://analytics.home-assistant.io/custom_integrations.json&query=$.ha_access_control_manager.total)](https://analytics.home-assistant.io/custom_integrations.json)
[![Hassfest](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hassfest.yml/badge.svg)](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hassfest.yml)
[![HACS Action](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hacs_action.yml/badge.svg)](https://github.com/Darkdragon14/ha-access-control-manager/actions/workflows/hacs_action.yml)
[![release](https://img.shields.io/github/v/release/Darkdragon14/ha-access-control-manager.svg)](https://github.com/Darkdragon14/ha-access-control-manager/releases)

"Access Control Manager" provides a centralized interface for managing user permissions and access rights within Home Assistant. It allows administrators to create, assign, and customize roles, ensuring secure and streamlined control over who can interact with specific devices, automations, and dashboards in the smart home ecosystem.

# Installation

## HACS installation

To install Access Control Manager using [HACS](https://hacs.xyz/):

1. Add this repository as a custom repository in HACS:
   - Go to **HACS** → **Integrations** → **Add Custom Repository**.
   - Enter the URL of this repository and select **Integration** as the category.
2. Search for "Access Control Manager" in HACS and install it.
3. Restart Home Assistant.
4. Go to **Settings** → **Devices & Services** → **Add Integration**.
5. Search for "Access Control Manager" and select it.

## Customizable options

|Option Name|Description|required|default Value|
|---|---|---|---|
|**Tab Icon**|Icon for the Access Control Manager tab, chosen from 23 MDI icons|No|`mdi:shield-account`|
|**Tab Name**|Name of the Access Control Manager tab.|No|`Access Control Manager`|
|**Path for Admin UI**|Custom URL path for accessing the admin interface|No|`/ha-access-control-manager`|

# Future improvements

* Adding a message to confirm or display an error when we save :rocket:

* Search system to quickly find resources :rocket:

* Adding a function to sanitize url for path_to_admin_ui :hammer_and_wrench:

* Improving error handling and code maintainability. :hammer_and_wrench:

# Missing Translation

If you want this component to support another language, feel free to submit a PR or create an issue. If you open an issue, I’ll gladly handle the translation for you! :smile:
