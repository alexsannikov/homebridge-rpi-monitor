#!/usr/bin/env bash
# Installs the rpi-monitor-server companion service for homebridge-rpi-monitor.
# Run this on the Raspberry Pi host — NOT inside the Homebridge container.
set -euo pipefail

INSTALL_DIR="/opt/rpi-monitor"
SERVICE_FILE="/etc/systemd/system/rpi-monitor.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root: sudo ./install.sh" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/rpi-monitor-server.py" "$INSTALL_DIR/rpi-monitor-server.py"
chmod 755 "$INSTALL_DIR/rpi-monitor-server.py"

cp "$SCRIPT_DIR/rpi-monitor.service" "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable --now rpi-monitor.service

echo "rpi-monitor.service installed and started."
echo "Test it with: curl http://127.0.0.1:8890/"
