while true; do
    if ! ps aux | grep -i "homeassistant" | grep -v grep > /dev/null; then
        echo "Home Assistant is not running, so we replace auth file by the new"
        if [ -e /config/.storage/auth.new ]; then
            mv /config/.storage/auth.new /config/.storage/auth
        fi
    fi
    sleep 1
done