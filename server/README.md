# Companion server for homebridge-rpi-monitor

This directory contains the small HTTP server that must run **on the
Raspberry Pi host itself** — not inside the Homebridge container — to
supply CPU temperature, undervoltage status, memory usage, disk usage,
and load average to the plugin.

## Files

- `rpi-monitor-server.py` — the HTTP server
- `rpi-monitor.service` — systemd unit definition
- `install.sh` — convenience installer (copies the two files above and
  enables the service)

## Automatic install

```bash
sudo ./install.sh
```

## Manual install

```bash
sudo mkdir -p /opt/rpi-monitor
sudo cp rpi-monitor-server.py /opt/rpi-monitor/
sudo chmod 755 /opt/rpi-monitor/rpi-monitor-server.py
sudo cp rpi-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rpi-monitor.service
```

## Verifying

```bash
curl http://127.0.0.1:8890/
```

Expected output:
```json
{"temp": 45.2, "undervoltage": false, "mem_used_pct": 23.1, "disk_used_pct": 41.7, "load1": 0.12}
```

## Notes

- The server binds to `127.0.0.1` only — it is never reachable from the LAN.
- `vcgencmd get_throttled` requires either running as `root` (the default
  in the provided unit) or running as a user in the `video` group. If you
  prefer not to run as root, create a dedicated user, add it to `video`,
  and change `User=` in `rpi-monitor.service` accordingly.
- If Homebridge runs in Docker with `network_mode: host`, `127.0.0.1`
  inside the container resolves to the host's own loopback interface, so
  no additional network configuration is required.
- If Homebridge runs in Docker **without** host networking, either switch
  to host networking (recommended for Homebridge in general, due to
  mDNS/Bonjour requirements) or expose the server on the Docker bridge
  network and adjust the `url` setting in the plugin config accordingly.

## Troubleshooting

Check the service status and logs:
```bash
sudo systemctl status rpi-monitor.service
sudo journalctl -u rpi-monitor.service -f
```

Common issues:

- `Command '['vcgencmd', 'get_throttled']' returned non-zero exit status 1`
  — the service user isn't in the `video` group (or isn't root). See the
  note above.
- Connection refused from the plugin — check the `network_mode` of the
  Homebridge container and the `url` setting in the plugin config.
