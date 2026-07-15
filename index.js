import http from 'node:http';

const CACHE_TTL_MS = 5000;
const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 5;
const PLUGIN_NAME = 'homebridge-rpi-monitor';
const PLATFORM_NAME = 'RPiMonitor';

// Used to derive accessory UUIDs. This must never change once the plugin
// has shipped — changing it would make every existing installation's
// accessories re-appear as brand-new ones in HomeKit, losing room
// assignments and automations. It is deliberately a separate constant from
// PLUGIN_NAME so that renaming the npm package in the future doesn't
// accidentally break accessory identity.
const UUID_NAMESPACE = 'homebridge-rpi-monitor';

// Module-level cache shared by every accessory in this process, so multiple
// characteristics don't trigger multiple HTTP requests within the same
// polling window.
let cache = {};
let cacheTime = 0;
let pending = null;

function fetchStats(url) {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL_MS) {
    return Promise.resolve(cache);
  }
  if (pending) {
    return pending;
  }

  pending = new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          cache = JSON.parse(data);
          cacheTime = Date.now();
        } catch {
          // Keep the previous cached value if the response wasn't valid JSON.
        }
        pending = null;
        resolve(cache);
      });
      res.on('error', () => {
        pending = null;
        resolve(cache);
      });
    });

    req.setTimeout(4000, () => {
      req.destroy();
    });

    req.on('error', () => {
      pending = null;
      resolve(cache);
    });
  });

  return pending;
}

export default (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RPiMonitorPlatform);
};

// Fixed catalogue of every sensor this plugin can expose. "key" seeds the
// accessory's UUID and must stay constant forever, independent of display
// names or config field names, which are free to change.
function buildSensorDefinitions(api, config) {
  const { Service, Characteristic } = api.hap;
  const sensors = config.sensors || {};

  return [
    {
      key: 'temperature',
      wanted: true, // always on, not configurable
      name: config.tempName || 'CPU Temperature',
      intervalKey: 'tempInterval',
      ServiceType: Service.TemperatureSensor,
      CharacteristicType: Characteristic.CurrentTemperature,
      extract: (stats) => (typeof stats.temp === 'number' ? stats.temp : 0),
    },
    {
      key: 'undervoltage',
      wanted: sensors.undervoltage === true,
      name: config.throttleName || 'Power Warning',
      intervalKey: 'throttleInterval',
      ServiceType: Service.ContactSensor,
      CharacteristicType: Characteristic.ContactSensorState,
      extract: (stats) => (stats.undervoltage
        ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : Characteristic.ContactSensorState.CONTACT_DETECTED),
    },
    {
      key: 'memory',
      wanted: sensors.memory === true,
      name: config.memName || 'Memory Usage',
      intervalKey: 'memInterval',
      ServiceType: Service.HumiditySensor,
      CharacteristicType: Characteristic.CurrentRelativeHumidity,
      extract: (stats) => (typeof stats.mem_used_pct === 'number' ? stats.mem_used_pct : 0),
    },
    {
      key: 'disk',
      wanted: sensors.disk === true,
      name: config.diskName || 'Disk Usage',
      intervalKey: 'diskInterval',
      ServiceType: Service.HumiditySensor,
      CharacteristicType: Characteristic.CurrentRelativeHumidity,
      extract: (stats) => (typeof stats.disk_used_pct === 'number' ? stats.disk_used_pct : 0),
    },
    {
      key: 'load',
      wanted: sensors.load === true,
      name: config.loadName || 'Load Average',
      intervalKey: 'loadInterval',
      ServiceType: Service.LightSensor,
      CharacteristicType: Characteristic.CurrentAmbientLightLevel,
      // LightSensor's CurrentAmbientLightLevel can't be 0 per the HAP spec;
      // load average has no natural upper bound, so give it a generous ceiling.
      props: { minValue: 0.0001, maxValue: 1000 },
      extract: (stats) => Math.max(0.0001, typeof stats.load1 === 'number' ? stats.load1 : 0.0001),
    },
  ];
}

class RPiMonitorPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.url = this.config.url || 'http://127.0.0.1:8890/';

    // UUID -> PlatformAccessory restored from Homebridge's on-disk cache.
    // Populated by configureAccessory(), which Homebridge calls once per
    // cached accessory before "didFinishLaunching" fires.
    this.cachedAccessories = new Map();

    // UUID -> interval handle. Kept outside of accessory.context on purpose:
    // context is serialized to JSON and persisted to disk, and a live timer
    // handle can't survive that round trip.
    this.timers = new Map();

    this.api.on('didFinishLaunching', () => {
      this.discoverAccessories();
    });
  }

  // Required by the Dynamic Platform API. Called once per accessory this
  // platform registered in a previous run, before "didFinishLaunching".
  configureAccessory(accessory) {
    this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  resolveInterval(configKey) {
    const globalInterval = Number(this.config.updateInterval);
    const fallback = Number.isFinite(globalInterval) && globalInterval >= MIN_INTERVAL_SECONDS
      ? globalInterval
      : DEFAULT_INTERVAL_SECONDS;

    if (this.config.useIndividualIntervals !== true) {
      return fallback;
    }

    const individual = Number(this.config[configKey]);
    return Number.isFinite(individual) && individual >= MIN_INTERVAL_SECONDS
      ? individual
      : fallback;
  }

  clearTimer(uuid) {
    const timer = this.timers.get(uuid);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(uuid);
    }
  }

  // Reconciles the sensors requested by the current config against the
  // accessories Homebridge already knows about: reuses matching cached
  // accessories (stable identity, no re-pairing), registers new ones, and
  // unregisters ones that are no longer wanted.
  discoverAccessories() {
    const definitions = buildSensorDefinitions(this.api, this.config);
    const seenUUIDs = new Set();
    const newAccessories = [];

    for (const def of definitions) {
      if (!def.wanted) {
        continue; // handled by the removal pass below
      }

      const uuid = this.api.hap.uuid.generate(`${UUID_NAMESPACE}:${def.key}`);
      seenUUIDs.add(uuid);

      let accessory = this.cachedAccessories.get(uuid);
      if (accessory) {
        this.log.info(`Reusing cached accessory: ${def.name}`);
        accessory.displayName = def.name;
      } else {
        this.log.info(`Adding new accessory: ${def.name}`);
        accessory = new this.api.platformAccessory(def.name, uuid);
        accessory.category = this.api.hap.Categories.SENSOR;
        newAccessories.push(accessory);
      }

      this.setupAccessory(accessory, def);
    }

    if (newAccessories.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);
    }

    const staleAccessories = [];
    for (const [uuid, accessory] of this.cachedAccessories) {
      if (!seenUUIDs.has(uuid)) {
        this.log.info(`Removing accessory no longer enabled in config: ${accessory.displayName}`);
        this.clearTimer(uuid);
        staleAccessories.push(accessory);
      }
    }
    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }

  // Wires up (or re-wires, for a reused cached accessory) the single service
  // and characteristic for one sensor definition, plus its refresh timer.
  setupAccessory(accessory, def) {
    const { Characteristic } = this.api.hap;

    const service = accessory.getService(def.ServiceType) || accessory.addService(def.ServiceType, def.name);
    service.updateCharacteristic(Characteristic.Name, def.name);

    const characteristic = service.getCharacteristic(def.CharacteristicType);
    if (def.props) {
      characteristic.setProps(def.props);
    }

    const readValue = async () => {
      const stats = await fetchStats(this.url);
      return def.extract(stats);
    };

    characteristic.onGet(async () => {
      try {
        return await readValue();
      } catch (err) {
        this.log.error(`[${def.name}] Failed to read value: ${err.message}`);
        return characteristic.value;
      }
    });

    // Replace any previous timer for this accessory (e.g. the configured
    // interval changed since the last run) instead of stacking a new one.
    this.clearTimer(accessory.UUID);
    const interval = this.resolveInterval(def.intervalKey);
    if (Number.isFinite(interval) && interval > 0) {
      const timer = setInterval(() => {
        readValue()
          .then((value) => characteristic.updateValue(value))
          .catch((err) => {
            this.log.error(`[${def.name}] Failed to refresh value: ${err.message}`);
          });
      }, interval * 1000);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      this.timers.set(accessory.UUID, timer);
    }
  }
}
