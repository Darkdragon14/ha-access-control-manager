DOMAIN = "ha_access_control_manager"

BASE_PATH = "custom_components/ha_access_control_manager"
SCRIPT_JS = "ha-access-control-manager.js"
SOURCE_PATH_SCRIPT_JS = f"{BASE_PATH}/www/{SCRIPT_JS}"
DEST_PATH_SCRIPT_JS = "www/community/ha-access-control-manager"
AUTH_PATH = ".storage/auth"
NEW_AUTH_PATH = ".storage/auth.new"
SCRIPT_BASH = f"{BASE_PATH}/www/replace-auth.sh"

ICONS = [
    "mdi:lock","mdi:lock-open","mdi:key",
    "mdi:shield-lock","mdi:shield-key","mdi:shield-check",
    "mdi:account-lock","mdi:account","mdi:account-group",
    "mdi:account-key","mdi:key-variant","mdi:account-check",
    "mdi:account-lock-outline","mdi:account-circle","mdi:link",
    "mdi:link-variant","mdi:web","mdi:share-variant",
    "mdi:star","mdi:bell","mdi:email","mdi:shield-account"
]