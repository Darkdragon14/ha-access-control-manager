import os
import subprocess
import logging

_LOGGER = logging.getLogger(__name__)


def is_script_running(script_name: str) -> bool:
    result = subprocess.run(['pgrep', '-f', script_name], stdout=subprocess.PIPE)
    return result.returncode == 0 

def start_script(script_path: str):
    try:
        subprocess.Popen(['nohup', 'bash', script_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _LOGGER.info(f"Script {script_path} launch with success.")
    except Exception as e:
        _LOGGER.error(f"Error when we start the script {script_path}: {e}")