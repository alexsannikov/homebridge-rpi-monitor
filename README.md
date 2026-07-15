# homebridge-rpi-monitor

A minimal [Homebridge](https://homebridge.io) plugin that exposes Raspberry
Pi system metrics — **CPU temperature**, **undervoltage (power warning)**,
**memory usage**, **disk usage**, and **load average** — to Apple HomeKit.

Unlike most Raspberry Pi Homebridge plugins, this one does **not** depend on
`pigpiod` or `rgpiod`. It talks to a tiny companion HTTP server (included in
this repo, see [`server/`](server)) running directly on the Raspberry Pi
host, which makes it a good fit for Homebridge running inside a Docker
container — no GPIO daemon, no bind-mounted volumes, no binary socket
protocol.

> **Note:** this plugin is not part of the
> [Verified by Homebridge](https://github.com/homebridge/plugins/wiki/Verified-Plugins)
> program, so it won't show a "Verified" checkmark in Config UI X.
> Verification mainly affects search placement and a trust badge, not how
> the plugin works.

## Disclaimer

This software is provided **"as is", without warranty of any kind**,
express or implied — see [LICENSE](./LICENSE) for the full MIT text.
Nothing here is guaranteed: not that it works correctly on your setup,
not that it will keep working after a future Homebridge/Node/npm update,
and not that issues or pull requests will be looked at. Support, if it
happens at all, happens via [GitHub issues](../../issues) whenever the
maintainer has time — there's no commitment attached, implicit or
otherwise. It's shared as-is in case it's useful to someone else. Read
the (short) source before running it against your own hardware, and use
it at your own risk.

## How it works

```
┌────────────────────────────┐        ┌───────────────────────────────┐
│ Raspberry Pi host           │        │ Homebridge (Docker container)  │
│                              │        │                                 │
│ rpi-monitor.service          │  HTTP  │ homebridge-rpi-monitor plugin  │
│ (rpi-monitor-server.py)     │◄───────┤ polls http://127.0.0.1:8890/   │
│ reads /sys, /proc, vcgencmd │  GET   │                                 │
└────────────────────────────┘        └───────────────────────────────┘
```

The companion server reads system files and `vcgencmd`, and serves the
result as a small JSON document. The plugin polls that endpoint (cached
for 5 seconds server-side) and pushes each value onto HomeKit at a
configurable interval.

## Features

- **CPU temperature** — Temperature Sensor, always on
- **Undervoltage / power warning** — Contact Sensor, opt-in
- **Memory usage** — Humidity Sensor (0–100%), opt-in
- **Disk usage** (`/`) — Humidity Sensor (0–100%), opt-in
- **Load average (1 min)** — Light Sensor, opt-in
- Configurable update interval — one shared value for all sensors, or a
  separate interval per sensor
- No `pigpiod`/`rgpiod`, no GPIO daemon, no Docker volumes
- Zero runtime npm dependencies

All sensors other than temperature are **off by default** — enable the
ones you want from the plugin's Config UI X settings page or in
`config.json`.

> Memory usage and disk usage are mapped onto HomeKit's Humidity Sensor,
> and load average onto its Light Sensor, since HomeKit has no native
> "percentage" or "arbitrary number" sensor type. This is a common
> convention among Homebridge system-monitoring plugins — the values
> shown are not actually humidity or light level.

## Requirements

- A Raspberry Pi running Homebridge (natively, or in Docker — `network_mode:
  host` recommended for Homebridge in general)
- Python 3 on the host (preinstalled on Raspberry Pi OS)
- `vcgencmd` available on the host (part of Raspberry Pi OS firmware tools) —
  only required if the power warning sensor is enabled

## Installation

### 1. Install the companion server on the Raspberry Pi host

This step runs **on the host**, not inside the Homebridge container.

```bash
git clone https://github.com/alexsannikov/homebridge-rpi-monitor.git
cd homebridge-rpi-monitor/server
sudo ./install.sh
```

Verify it's working:
```bash
curl http://127.0.0.1:8890/
# {"temp": 45.2, "undervoltage": false, "mem_used_pct": 23.1, "disk_used_pct": 41.7, "load1": 0.12}
```

See [server/README.md](server/README.md) for manual installation steps
and troubleshooting.

### 2. Install the plugin

Via Homebridge Config UI X: search for `homebridge-rpi-monitor` and click
Install.

Or manually:
```bash
npm install -g homebridge-rpi-monitor
```

### 3. Configure

Via Config UI X, the plugin settings page lets you toggle each sensor and
set update intervals without touching JSON. Or edit `config.json`
directly:

```json
{
  "platforms": [
    {
      "platform": "RPiMonitor",
      "name": "Raspberry Pi",
      "url": "http://127.0.0.1:8890/",
      "updateInterval": 30,
      "sensors": {
        "undervoltage": true,
        "memory": true,
        "disk": false,
        "load": false
      }
    }
  ]
}
```

#### Common vs. individual update intervals

By default, `updateInterval` applies to every enabled sensor. If you want
different sensors to refresh at different rates (e.g. load average every
15 seconds, disk usage every 5 minutes), set `useIndividualIntervals` to
`true` and provide a `*Interval` value per sensor:

```json
{
  "platforms": [
    {
      "platform": "RPiMonitor",
      "name": "Raspberry Pi",
      "updateInterval": 30,
      "useIndividualIntervals": true,
      "tempInterval": 30,
      "sensors": { "disk": true, "load": true },
      "diskInterval": 300,
      "loadInterval": 15
    }
  ]
}
```
Any sensor whose individual interval is left unset falls back to
`updateInterval`.

## Configuration reference

| Key | Type | Default | Description |
|---|---|---|---|
| `name` | string | `Raspberry Pi` | Platform name shown in Homebridge logs |
| `url` | string | `http://127.0.0.1:8890/` | URL of the companion stats server |
| `updateInterval` | integer (seconds) | `30` | Shared refresh interval for all sensors (minimum 5) |
| `useIndividualIntervals` | boolean | `false` | Use a separate interval per sensor instead of the shared one |
| `tempName` / `tempInterval` | string / integer | `CPU Temperature` / `30` | Temperature accessory name / interval |
| `sensors.undervoltage` | boolean | `false` | Enable the power warning (Contact Sensor) accessory |
| `throttleName` / `throttleInterval` | string / integer | `Power Warning` / `30` | Power warning accessory name / interval |
| `sensors.memory` | boolean | `false` | Enable the memory usage (Humidity Sensor) accessory |
| `memName` / `memInterval` | string / integer | `Memory Usage` / `30` | Memory usage accessory name / interval |
| `sensors.disk` | boolean | `false` | Enable the disk usage (Humidity Sensor) accessory |
| `diskName` / `diskInterval` | string / integer | `Disk Usage` / `30` | Disk usage accessory name / interval |
| `sensors.load` | boolean | `false` | Enable the load average (Light Sensor) accessory |
| `loadName` / `loadInterval` | string / integer | `Load Average` / `30` | Load average accessory name / interval |

Temperature is always exposed and cannot be disabled.

## Troubleshooting

See the [Wiki](../../wiki) for detailed setup notes, Docker-specific
guidance, and common errors.

## Contributing

Issues and pull requests are welcome, though see the
[Disclaimer](#disclaimer) above — there's no guarantee they'll be looked
at promptly, or at all.

## License

[MIT](./LICENSE)
