#!/usr/bin/env python3
"""
rpi-monitor-server.py

Minimal HTTP server exposing Raspberry Pi system metrics as JSON:
CPU temperature, undervoltage status, memory usage, disk usage, and
1-minute load average.

Intended to be polled by the homebridge-rpi-monitor Homebridge plugin,
which typically runs inside a Docker container and therefore cannot read
host-level sensors directly.

Binds to 127.0.0.1 only — never exposed to the LAN.

Run this on the Raspberry Pi host itself (see rpi-monitor.service and
install.sh in this directory), not inside the Homebridge container.
"""

import http.server
import socketserver
import json
import subprocess
import shutil

HOST = "127.0.0.1"
PORT = 8890
THERMAL_FILE = "/sys/class/thermal/thermal_zone0/temp"


def get_stats():
    with open(THERMAL_FILE) as f:
        temp = round(int(f.read().strip()) / 1000, 1)

    result = subprocess.run(
        ["vcgencmd", "get_throttled"],
        capture_output=True,
        text=True,
        check=True,
    )
    throttled = int(result.stdout.strip().split("=")[-1], 16)
    undervoltage = bool(throttled & 0x1)  # bit 0 = undervoltage right now

    meminfo = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, _, rest = line.partition(":")
            meminfo[key] = int(rest.strip().split()[0])
    mem_used_pct = round((1 - meminfo["MemAvailable"] / meminfo["MemTotal"]) * 100, 1)

    disk = shutil.disk_usage("/")
    disk_used_pct = round(disk.used / disk.total * 100, 1)

    with open("/proc/loadavg") as f:
        load1 = float(f.read().split()[0])

    return {
        "temp": temp,
        "undervoltage": undervoltage,
        "mem_used_pct": mem_used_pct,
        "disk_used_pct": disk_used_pct,
        "load1": load1,
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            body = json.dumps(get_stats()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            self.send_response(500)
            self.end_headers()

    def log_message(self, format, *args):
        # Keep the systemd journal quiet — this endpoint gets polled every
        # few seconds by Homebridge.
        pass


if __name__ == "__main__":
    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        httpd.serve_forever()
