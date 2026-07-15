# Changelog

All notable changes to this project will be documented in this file.

## 0.0.1-beta

- Initial beta release
- CPU temperature exposed as a Temperature Sensor (always on)
- Undervoltage / power warning exposed as a Contact Sensor (opt-in)
- Memory usage exposed as a Humidity Sensor (opt-in)
- Disk usage exposed as a Humidity Sensor (opt-in)
- Load average (1 min) exposed as a Light Sensor (opt-in)
- Config UI X settings schema with per-sensor toggles, all off by default
  except temperature
- Configurable update interval — shared across all sensors, or set
  individually per sensor via `useIndividualIntervals`
- Dynamic platform with stable accessory identity: each sensor's UUID is
  derived from a fixed internal key, so renaming a sensor or restarting
  Homebridge never affects its room assignment, automations, or history
