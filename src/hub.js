// -----------------------------------------------------------------------------
// The Blue Iris hub: the configured server, read on the container's own
// timer, and its cameras.
//
//   - every `refresh_interval` (10 s by default) the hub reads `status`
//     (profile, signal, CPU, disks) and `camlist` (online, motion, trigger,
//     time of the last alert of each camera). Gladys never polls: the devices
//     are published with should_poll: false (GladysAssistant/Gladys#3198), and
//     onPoll only refreshes when the timer is late;
//   - a camera whose last alert time moved: its new alerts are read
//     (`alertlist`), and each one fires the `camera_alert` scene trigger with
//     what Blue Iris (and its AI) saw: person, vehicle, animal, motion,
//     sound, external. A fresh image of the camera is sent to Gladys first,
//     so a scene sending "the camera image" sends the right one. Person and
//     vehicle are also states of the camera (on at the alert, off once the
//     camera is no longer triggered and 30 s passed);
//   - at start, the alerts of the last 24 hours are the baseline: they fire
//     nothing, and tell which cameras have an AI (person/vehicle features);
//   - images: on each alert, on the timer chosen in the configuration, on
//     demand (onGetImage, scene action, widget).
//
// Commands: the profile and the signal (selects of the server), PTZ moves and
// presets (features of the camera), a manual trigger (scene action, widget).
// Arming is always allowed; disarming (signal red, profile 0 "Inactive" or a
// profile listed as disarmed) only when the configuration allows it. A PTZ
// move is bounded by a watchdog (2 s): a lost stop never leaves a camera
// turning.
//
// States go through publishChangedStates (only the changes, plus a heartbeat
// every 6 hours: the front shows "no recent value" past 48 hours), and only
// for the devices the user added: Gladys drops the others.
//
// Logs: info keeps the lifecycle (connected, the server or a camera lost and
// back, user commands); a problem that repeats is logged once, and once when
// it clears; the rest goes to debug (LOG_LEVEL=debug). Never a password nor a
// session id.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { BlueIrisClient, BlueIrisError, ERROR_KINDS } from './blueiris/client.js';
import {
  DETECTIONS,
  INACTIVE_PROFILE,
  MOVE_TO_BUTTON,
  PRESET_BUTTON_BASE,
  PROFILE_COUNT,
  SIGNALS,
  SIGNAL_TO_CODE,
  parseAlerts,
  parseCameras,
  parsePresets,
  parseServerInfo,
  parseStatus,
} from './blueiris/model.js';
import {
  CAMERA_KEYS,
  DEFAULT_NAMES,
  LEARNABLE,
  SERVER_KEYS,
  buildCameraDevice,
  buildServerDevice,
  cameraFeatureKeys,
  cameraIds,
  cameraValues,
  serverIds,
  serverValues,
} from './devices.js';
import { fittedCameraImage } from './image.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  DETECTION_NAMES,
  ERROR_TEXT,
  REPORT_TEXT,
  localized,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'blue-iris' });

export const WIDGET_KEY = 'blue_iris';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({ ALERT: 'camera_alert' });

export const HUB_TIMINGS = {
  heartbeatMs: 6 * 60 * 60_000,
  // A person or a vehicle stays detected this long after its alert at least,
  // then until the camera is no longer triggered.
  detectionHoldMs: 30_000,
  // The core takes 12 images a minute per camera at most.
  imageSpacingMs: 6_000,
  // A scene event waits this long at most for the fresh image of its camera.
  alertImageWaitMs: 4_000,
  // A PTZ move stops by itself after this (the core asks for a watchdog).
  ptzWatchdogMs: 2_000,
  // Read again this soon after a command, to show what Blue Iris did.
  afterCommandMs: 1_500,
  // The camera list structure and the PTZ presets are read again this often.
  describeMs: 6 * 60 * 60_000,
  alertLookbackMs: 24 * 60 * 60_000,
};

// Alerts kept for the widget, and handled per camera and read.
export const MAX_ALERTS = 8;
export const MAX_ALERTS_PER_READ = 5;
const DAY_MS = 24 * 60 * 60_000;
const MAX_COUNTED = 5000;

const AI_KINDS = new Set([DETECTIONS.PERSON, DETECTIONS.VEHICLE]);

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const serverSignature = (config) =>
  config.server
    ? JSON.stringify([config.server.origin, config.server.username, config.server.password])
    : null;

export class BlueIrisHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/blueiris/http.js)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.clientTimings] CLIENT_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, clientTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    /** What was learned of the server: { systemName, version, user, rights, profiles }. */
    this.server = null;
    this.describedAt = null;
    /** By short name: { short, name, ptz, presets, learned: Set }. */
    this.cameras = new Map();
    /** By short name: the camera of the last camera list. */
    this.live = new Map();
    this.status = null;
    this.read = { ok: null, error: null, downSince: null };
    this.lastReadAt = null;
    /** By short name: Map(kind → since) of the AI detections still on. */
    this.detected = new Map();
    /** By short name: date (ms) of the newest alert handled, and alertutc seen. */
    this.lastAlertAt = new Map();
    this.lastAlertUtc = new Map();
    this.alertsReady = false;
    this.wasTriggered = new Set();
    /** Alerts, newest first: { id, at, short, kind, imageKey }. */
    this.alerts = [];
    this.alertTimes = [];
    this.alertCount = 0;
    this.thumbnails = new Map();
    /** Last image per short name: { at, image }. */
    this.images = new Map();
    this.imageReads = new Map();
    this.cameraOnline = new Map();
    this.serverOnline = null;
    this.transports = new Map();
    this.connection = null;
    this.discovery = null;
    this.reading = null;
    this.refreshTimer = null;
    this.snapshotTimer = null;
    this.quickTimer = null;
    /** PTZ moves in progress, by short name: { button, timer }. */
    this.moves = new Map();
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  get rights() {
    return this.server?.rights ?? { admin: false, changeProfile: false, ptz: false };
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn, error or info), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say so once, the next occurrence logs again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    if (saved.server && typeof saved.server === 'object') {
      this.server = {
        systemName: saved.server.systemName ?? null,
        version: saved.server.version ?? null,
        user: saved.server.user ?? null,
        rights: { admin: false, changeProfile: false, ptz: false, ...saved.server.rights },
        profiles: Array.isArray(saved.server.profiles)
          ? saved.server.profiles
          : new Array(PROFILE_COUNT).fill(null),
      };
    }
    for (const entry of Array.isArray(saved.cameras) ? saved.cameras : []) {
      if (entry && typeof entry.short === 'string' && entry.short) {
        this.cameras.set(entry.short, {
          short: entry.short,
          name: typeof entry.name === 'string' && entry.name ? entry.name : entry.short,
          ptz: Boolean(entry.ptz),
          presets: Array.isArray(entry.presets)
            ? entry.presets.filter((preset) => Number.isInteger(preset?.num))
            : [],
          learned: new Set(
            (Array.isArray(entry.learned) ? entry.learned : []).filter((key) =>
              LEARNABLE.includes(key),
            ),
          ),
        });
      }
    }
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovery = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const next = serverSignature(config);
    const changed = next !== this.signature;
    this.config = config;
    if (changed) {
      this.signature = next;
      this.stopMoves();
      await this.client?.logout();
      this.client = config.server
        ? new BlueIrisClient({
            server: config.server,
            request: this.request,
            timings: this.clientTimings,
          })
        : null;
      this.read = { ok: null, error: null, downSince: null };
      this.live.clear();
      this.status = null;
      this.describedAt = null;
      this.alertsReady = false;
      this.lastAlertAt.clear();
      this.lastAlertUtc.clear();
      if (!config.server) {
        // No server any more: nothing to discover.
        this.server = null;
        this.cameras.clear();
        this.save();
        if (config.problem === 'invalidHost') {
          this.problem('config', 'The address of Blue Iris in the configuration is not understood');
        }
      } else {
        this.resolved('config');
      }
    }
    // A new language renames the features: the Discovery tab shows them.
    this.discovery = null;
    if (!this.client) {
      clearTimeout(this.refreshTimer);
      clearTimeout(this.snapshotTimer);
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    await this.refresh({ describe: changed });
    this.scheduleRefresh();
    this.scheduleSnapshots();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.quickTimer);
    await this.stopMoves();
    await this.client?.logout();
    await this.store.flush();
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.refreshTimer = setTimeout(async () => {
      await this.refresh();
      this.scheduleRefresh();
    }, this.config.refreshMs);
  }

  scheduleSnapshots() {
    clearTimeout(this.snapshotTimer);
    const interval = this.config?.snapshotIntervalMs ?? 0;
    if (!this.timersEnabled || this.stopped || !this.client || interval <= 0) {
      return;
    }
    this.snapshotTimer = setTimeout(async () => {
      await this.snapshotAll();
      this.scheduleSnapshots();
    }, interval);
  }

  /** Read again shortly after a command, to show what Blue Iris did. */
  refreshSoon() {
    clearTimeout(this.quickTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.quickTimer = setTimeout(() => {
      this.refresh().catch(() => {});
    }, this.timings.afterCommandMs);
    this.quickTimer.unref?.();
  }

  /** Gladys polls anyway: read only when the timer is late (half a period). */
  async poll() {
    const period = this.config?.refreshMs ?? 10_000;
    if (this.lastReadAt !== null && this.now() - this.lastReadAt < period / 2) {
      return;
    }
    await this.refresh();
  }

  // --- Reading Blue Iris -------------------------------------------------------

  /** Read the server. Concurrent calls share the read. */
  refresh({ describe = false } = {}) {
    if (describe) {
      this.describedAt = null;
    }
    this.reading ??= this.readAll().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readAll() {
    const client = this.client;
    if (!client) {
      return false;
    }
    this.lastReadAt = this.now();
    let ok = true;
    try {
      const describe =
        this.describedAt === null || this.now() - this.describedAt >= this.timings.describeMs;
      if (describe && client.session) {
        // Fresh login data: the profile names and the rights may have changed.
        await client.logout();
      }
      const status = parseStatus(await client.command('status'));
      const cameras = parseCameras(await client.command('camlist'));
      if (client !== this.client) {
        return false; // reconfigured while reading
      }
      this.status = status;
      if (describe || !this.server) {
        this.server = parseServerInfo(client.info);
      }
      await this.describeCameras(cameras, describe);
      if (describe) {
        this.describedAt = this.now();
      }
      this.readSucceeded();
      await this.readAlerts(cameras);
    } catch (err) {
      if (client !== this.client) {
        return false;
      }
      this.readFailed(err);
      ok = false;
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.afterChanges();
    return ok;
  }

  /** The camera list: new cameras described (PTZ presets), the gone ones dropped. */
  async describeCameras(list, describe) {
    const next = new Map();
    let changed = false;
    for (const camera of list) {
      const known = this.cameras.get(camera.short);
      let presets = known?.presets ?? [];
      const ptzChanged = !known || known.ptz !== camera.ptz;
      if (camera.ptz && this.rights.ptz && (describe || ptzChanged)) {
        try {
          presets = parsePresets(await this.client.command('ptz', { camera: camera.short }));
        } catch (err) {
          logger.debug(`PTZ presets of ${camera.name} not read: ${err.message}`);
        }
      }
      const entry = {
        short: camera.short,
        name: camera.name,
        ptz: camera.ptz,
        presets: camera.ptz ? presets : [],
        learned: known?.learned ?? new Set(),
      };
      if (
        !known ||
        known.name !== entry.name ||
        known.ptz !== entry.ptz ||
        JSON.stringify(known.presets) !== JSON.stringify(entry.presets)
      ) {
        changed = true;
      }
      next.set(camera.short, entry);
    }
    if (next.size !== this.cameras.size) {
      changed = true;
    }
    this.cameras = next;
    this.live = new Map(list.map((camera) => [camera.short, camera]));
    if (changed || describe) {
      this.save();
    }
  }

  readSucceeded() {
    const read = this.read;
    const first = read.ok === null;
    const wasDown = read.ok === false;
    read.ok = true;
    read.error = null;
    const version = this.server?.version ? ` ${this.server.version}` : '';
    const label = `Blue Iris${version} at ${this.client.label}`;
    if (first) {
      const rights = this.rights.admin
        ? 'administrator'
        : this.rights.changeProfile
          ? 'may change profiles'
          : 'read only';
      logger.info(`Connected to ${label}: ${this.cameras.size} camera(s), user ${rights}`);
    } else if (wasDown) {
      const minutes = Math.max(1, Math.round((this.now() - read.downSince) / 60_000));
      logger.info(`${label} answers again after ${minutes} min`);
    }
    this.warned.delete('read');
    read.downSince = null;
  }

  readFailed(err) {
    const read = this.read;
    if (read.ok !== false) {
      read.downSince = this.now();
    }
    read.ok = false;
    read.error = err;
    const level = err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn';
    this.problem('read', `Cannot read Blue Iris at ${this.client.label}: ${err.message}`, level);
  }

  save() {
    return this.store.save({
      server: this.server,
      cameras: [...this.cameras.values()].map((camera) => ({
        short: camera.short,
        name: camera.name,
        ptz: camera.ptz,
        presets: camera.presets,
        learned: [...camera.learned],
      })),
    });
  }

  // --- Alerts and their scene events --------------------------------------------

  async readAlerts(cameras) {
    if (!this.alertsReady) {
      await this.readAlertBaseline(cameras);
      return;
    }
    const wasTriggered = this.wasTriggered;
    this.wasTriggered = new Set(cameras.filter((c) => c.triggered).map((c) => c.short));
    for (const camera of cameras) {
      if (!this.lastAlertAt.has(camera.short)) {
        // A camera added to Blue Iris since the start: its past fires nothing.
        this.baseline(camera);
        continue;
      }
      let due;
      if (camera.alertUtc !== null) {
        due = camera.alertUtc > (this.lastAlertUtc.get(camera.short) ?? 0);
        this.lastAlertUtc.set(camera.short, camera.alertUtc);
      } else {
        // An older server without alertutc: look while the camera is triggered.
        due = camera.triggered || wasTriggered.has(camera.short);
      }
      if (due) {
        await this.readCameraAlerts(camera);
      }
    }
  }

  /** What is known of a camera's alerts when it is first seen. */
  baseline(camera) {
    this.lastAlertUtc.set(camera.short, camera.alertUtc ?? 0);
    this.lastAlertAt.set(
      camera.short,
      Math.max(this.lastAlertAt.get(camera.short) ?? 0, (camera.alertUtc ?? 0) * 1000),
    );
  }

  /** At start: the last 24 hours are known, they fire nothing. */
  async readAlertBaseline(cameras) {
    let records = [];
    try {
      records = parseAlerts(
        await this.client.command('alertlist', {
          camera: 'index',
          view: 'alerts',
          startdate: Math.floor((this.now() - this.timings.alertLookbackMs) / 1000),
          enddate: Math.floor(this.now() / 1000) + 3600,
        }),
      );
      this.resolved('alerts');
    } catch (err) {
      this.problem('alerts', `The alerts of Blue Iris cannot be read: ${err.message}`);
    }
    for (const alert of records) {
      if (!this.cameras.has(alert.camera) || alert.cancelled) {
        continue;
      }
      this.lastAlertAt.set(
        alert.camera,
        Math.max(this.lastAlertAt.get(alert.camera) ?? 0, alert.at),
      );
      await this.learn(alert.camera, alert.kinds);
      this.remember(alert.camera, alert, { counted: true });
    }
    for (const camera of cameras) {
      this.baseline(camera);
    }
    this.wasTriggered = new Set(cameras.filter((c) => c.triggered).map((c) => c.short));
    this.alertsReady = true;
  }

  async readCameraAlerts(camera) {
    const since = this.lastAlertAt.get(camera.short) ?? 0;
    let records;
    // Tried at each new alert: only new alerts cost a request, and a failure
    // at start (a timeout) must not stop the reading for good.
    try {
      const start = Math.max(since, this.now() - this.timings.alertLookbackMs);
      records = parseAlerts(
        await this.client.command('alertlist', {
          camera: camera.short,
          view: 'alerts',
          startdate: Math.floor(start / 1000),
          enddate: Math.floor(this.now() / 1000) + 3600,
        }),
      );
      this.resolved('alerts', 'The alerts of Blue Iris can be read again');
    } catch (err) {
      this.problem('alerts', `The alerts of Blue Iris cannot be read: ${err.message}`);
    }
    if (!records) {
      // No alert list (no right): the time of the last alert is enough to fire.
      if (camera.alertUtc !== null && camera.alertUtc * 1000 > since) {
        this.lastAlertAt.set(camera.short, camera.alertUtc * 1000);
        await this.onAlert(camera.short, {
          at: camera.alertUtc * 1000,
          kinds: [DETECTIONS.OTHER],
          memo: '',
        });
      }
      return;
    }
    const fresh = records
      .filter((alert) => alert.camera === camera.short && !alert.cancelled && alert.at > since)
      .slice(-MAX_ALERTS_PER_READ);
    for (const alert of fresh) {
      this.lastAlertAt.set(
        camera.short,
        Math.max(this.lastAlertAt.get(camera.short) ?? 0, alert.at),
      );
      await this.onAlert(camera.short, alert);
    }
  }

  /** A kind of AI detection seen for the first time: the camera gains its feature. */
  async learn(short, kinds) {
    const camera = this.cameras.get(short);
    if (!camera) {
      return;
    }
    const missing = kinds.filter((kind) => AI_KINDS.has(kind) && !camera.learned.has(kind));
    if (missing.length === 0) {
      return;
    }
    for (const kind of missing) {
      camera.learned.add(kind);
    }
    this.save();
    logger.info(`${camera.name} reported ${missing.join(', ')}: feature added in Discover`);
  }

  async onAlert(short, alert) {
    const camera = this.cameras.get(short);
    if (!camera) {
      return;
    }
    const kind = alert.kinds[0];
    logger.debug(
      `Alert on ${camera.name}: ${alert.kinds.join(', ')}${alert.memo ? ` (${alert.memo})` : ''}`,
    );
    await this.learn(short, alert.kinds);
    const detected = this.detected.get(short) ?? new Map();
    for (const item of alert.kinds.filter((entry) => AI_KINDS.has(entry))) {
      detected.set(item, this.now());
    }
    this.detected.set(short, detected);
    const entry = this.remember(short, alert, { counted: true });
    await this.publishCameraStates(camera);
    await this.imageFor(camera, entry);
    await this.fire(TRIGGERS.ALERT, {
      camera: cameraIds(this.gladys, short).device,
      detection: kind,
      camera_name: camera.name,
      detection_name: pick(DETECTION_NAMES, this.language)[kind],
      memo: alert.memo || null,
    });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Keep an alert for the widget. */
  remember(short, alert, { counted }) {
    this.alertCount += 1;
    const entry = {
      id: `${Math.round(alert.at).toString(36)}${this.alertCount.toString(36)}`,
      at: alert.at,
      short,
      kind: alert.kinds[0],
      imageKey: null,
    };
    this.alerts.unshift(entry);
    this.alerts.sort((a, b) => b.at - a.at);
    for (const dropped of this.alerts.splice(MAX_ALERTS)) {
      this.thumbnails.delete(dropped.imageKey);
    }
    if (counted) {
      this.alertTimes.push(alert.at);
      if (this.alertTimes.length > MAX_COUNTED) {
        this.alertTimes.splice(0, this.alertTimes.length - MAX_COUNTED);
      }
    }
    return entry;
  }

  /** Alerts over the last 24 hours, of one camera or all. */
  alertsToday(short) {
    const since = this.now() - DAY_MS;
    if (short) {
      return this.alerts.filter((entry) => entry.short === short && entry.at >= since).length;
    }
    this.alertTimes = this.alertTimes.filter((at) => at >= since);
    return this.alertTimes.length;
  }

  /** A fresh image for an alert, waited for a few seconds at most. */
  async imageFor(camera, entry) {
    const read = this.cameraImage(camera.short).then((image) => {
      if (image && !entry.imageKey) {
        entry.imageKey = `al-${entry.id.replace(/[^a-z0-9]/g, '').slice(0, 40)}`;
        this.thumbnails.set(entry.imageKey, image.slice(image.indexOf(',') + 1));
      }
    });
    await Promise.race([read, delay(this.timings.alertImageWaitMs)]);
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  /** The AI detections still on: 30 s after the alert, until the camera calms down. */
  activeDetections(short) {
    const detected = this.detected.get(short);
    if (!detected) {
      return new Set();
    }
    const triggered = this.live.get(short)?.triggered;
    for (const [kind, since] of detected) {
      if (!triggered && this.now() - since >= this.timings.detectionHoldMs) {
        detected.delete(kind);
      }
    }
    return new Set(detected.keys());
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /** Whether the user added the device to Gladys. */
  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  get online() {
    return this.read.ok === true;
  }

  serverDescription() {
    return {
      ...(this.server ?? { profiles: [], rights: {} }),
      label: this.client?.label ?? '',
    };
  }

  buildDevices() {
    if (!this.client || !this.server) {
      return [];
    }
    return [
      buildServerDevice(this.gladys, this.serverDescription(), { language: this.language }),
      ...[...this.cameras.values()].map((camera) =>
        buildCameraDevice(this.gladys, camera, { language: this.language, rights: this.rights }),
      ),
    ];
  }

  async publishDevices() {
    const devices = this.buildDevices();
    const key = JSON.stringify(devices);
    if (key === this.discovery) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovery = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the cameras and their presets again. */
  async rediscover() {
    this.discovery = null;
    if (!this.client) {
      await this.publishDevices();
      return;
    }
    await this.refresh({ describe: true });
  }

  /** The user added a device: the SDK forgot its values, send them again. */
  async onDeviceCreated(device) {
    if (device.external_id === serverIds(this.gladys).device) {
      await this.publishServerStates();
    } else {
      const camera = this.findCamera(device.external_id);
      if (!camera) {
        return;
      }
      await this.publishCameraStates(camera);
      if (this.online && this.live.get(camera.short)?.online) {
        this.cameraImage(camera.short).catch(() => {});
      }
    }
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishAllStates() {
    await this.publishServerStates();
    for (const camera of this.cameras.values()) {
      await this.publishCameraStates(camera);
    }
  }

  async publish(ids, keys, values, what) {
    if (!this.isCreated(ids.device)) {
      return;
    }
    const states = keys
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) =>
        typeof values[key] === 'object'
          ? { device_feature_external_id: ids.feature(key), text: values[key].text }
          : { device_feature_external_id: ids.feature(key), state: values[key] },
      );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${what} refused: ${err.message}`);
    }
  }

  async publishServerStates() {
    if (!this.server) {
      return;
    }
    await this.publish(
      serverIds(this.gladys),
      Object.values(SERVER_KEYS),
      serverValues(this.status, this.online),
      'the server',
    );
  }

  async publishCameraStates(camera) {
    await this.publish(
      cameraIds(this.gladys, camera.short),
      cameraFeatureKeys(camera, this.rights),
      cameraValues(this.live.get(camera.short), this.activeDetections(camera.short), this.online),
      camera.name,
    );
  }

  /** After a read: the server and the cameras offline and back, transports, status, widget. */
  async afterChanges() {
    let changed = false;
    const online = this.online;
    if (this.serverOnline !== online) {
      if (this.serverOnline !== null) {
        logger.info(`Blue Iris at ${this.client?.label} is ${online ? 'online again' : 'offline'}`);
      }
      this.serverOnline = online;
      changed = true;
    }
    for (const camera of this.cameras.values()) {
      const live = this.live.get(camera.short);
      if (!online || !live) {
        continue;
      }
      const before = this.cameraOnline.get(camera.short);
      if (before !== live.online) {
        if (before !== undefined) {
          logger.info(`Camera ${camera.name} is ${live.online ? 'online again' : 'offline'}`);
        }
        this.cameraOnline.set(camera.short, live.online);
        changed = true;
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    const add = (externalId, reachable) => {
      if (!this.isCreated(externalId)) {
        return;
      }
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    };
    if (this.server) {
      add(serverIds(this.gladys).device, this.online);
      for (const camera of this.cameras.values()) {
        add(
          cameraIds(this.gladys, camera.short).device,
          this.online && Boolean(this.live.get(camera.short)?.online),
        );
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name, in the Configuration screen. */
  connectionStatus() {
    const config = this.config;
    if (!config?.server) {
      return {
        connected: false,
        message: CONNECTION_TEXT[config?.problem] ?? CONNECTION_TEXT.noHost,
      };
    }
    if (this.read.ok === null) {
      return null; // first read not done yet
    }
    if (this.read.ok === false) {
      const kind = this.read.error?.kind;
      const shown = kind === ERROR_KINDS.AUTH ? ERROR_KINDS.BLOCKED : kind;
      return { connected: false, message: ERROR_TEXT[shown] ?? ERROR_TEXT[ERROR_KINDS.HTTP] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    if (!status) {
      return;
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Camera images -------------------------------------------------------------

  /** The camera of a Gladys external id, null when unknown. */
  findCamera(externalId) {
    if (!externalId) {
      return null;
    }
    for (const camera of this.cameras.values()) {
      if (cameraIds(this.gladys, camera.short).device === externalId) {
        return camera;
      }
    }
    return null;
  }

  /**
   * A fresh image of a camera, sent to Gladys when the camera is added.
   * Concurrent calls share the read; a read younger than `imageSpacingMs` is
   * reused (the core takes 12 images a minute per camera).
   * @returns {Promise<string|null>} the `image/jpg;base64,…` string
   */
  cameraImage(short) {
    const last = this.images.get(short);
    if (last && this.now() - last.at < this.timings.imageSpacingMs) {
      return Promise.resolve(last.image);
    }
    const running = this.imageReads.get(short);
    if (running) {
      return running;
    }
    const read = this.readImage(short).finally(() => this.imageReads.delete(short));
    this.imageReads.set(short, read);
    return read;
  }

  async readImage(short) {
    const camera = this.cameras.get(short);
    const name = camera?.name ?? short;
    if (!this.client) {
      return null;
    }
    let image;
    try {
      image = await fittedCameraImage((step) => this.client.image(short, step));
      this.resolved(`image-${short}`, `Images of ${name}: back`);
    } catch (err) {
      this.problem(`image-${short}`, `No image from ${name}: ${err.message}`);
      return null;
    }
    this.images.set(short, { at: this.now(), image });
    const externalId = cameraIds(this.gladys, short).device;
    if (this.isCreated(externalId)) {
      try {
        await this.gladys.publishCameraImage(externalId, image);
        this.resolved('camera-image');
      } catch (err) {
        this.problem('camera-image', `Image of ${name} refused: ${err.message}`);
      }
    }
    return image;
  }

  /** The timer of the configuration: every added camera online, one after the other. */
  async snapshotAll() {
    if (!this.online) {
      return;
    }
    const half = (this.config?.snapshotIntervalMs ?? 0) / 2;
    for (const camera of this.cameras.values()) {
      const last = this.images.get(camera.short);
      // Skip a camera imaged less than half a period ago (an alert did it).
      if (
        !this.live.get(camera.short)?.online ||
        !this.isCreated(cameraIds(this.gladys, camera.short).device) ||
        (last && this.now() - last.at < half)
      ) {
        continue;
      }
      await this.cameraImage(camera.short);
    }
  }

  /** Gladys asks for a fresh image (live view, scene "send camera image"). */
  async getImage(device) {
    const camera = this.findCamera(device.external_id);
    if (!camera) {
      throw new Error(pick(ACTION_TEXT.unknownCamera, this.language));
    }
    const image = await this.cameraImage(camera.short);
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  // --- Commands --------------------------------------------------------------------

  requireClient() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    if (!this.server) {
      throw new Error(pick(ACTION_TEXT.notConnected, this.language));
    }
    return this.client;
  }

  requireCamera(externalId) {
    this.requireClient();
    if (!externalId) {
      throw new Error(pick(ACTION_TEXT.pickCamera, this.language));
    }
    const camera = this.findCamera(externalId);
    if (!camera) {
      throw new Error(pick(ACTION_TEXT.unknownCamera, this.language));
    }
    return camera;
  }

  /** A Blue Iris error as the user reads it; the details go to the log. */
  failure(err, what) {
    if (!(err instanceof BlueIrisError)) {
      return err;
    }
    logger.warn(`${what} failed: ${err.message}`);
    return new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], this.language), {
      cause: err,
    });
  }

  /** A command of a feature: profile, signal, PTZ move or preset. */
  async setValue(device, feature, value) {
    if (device.external_id === serverIds(this.gladys).device) {
      const ids = serverIds(this.gladys);
      if (feature.external_id === ids.feature(SERVER_KEYS.PROFILE)) {
        await this.setProfile(value);
        return;
      }
      if (feature.external_id === ids.feature(SERVER_KEYS.SIGNAL)) {
        await this.setSignal(value);
        return;
      }
    } else {
      const camera = this.findCamera(device.external_id);
      const ids = camera ? cameraIds(this.gladys, camera.short) : null;
      if (ids && feature.external_id === ids.feature(CAMERA_KEYS.MOVE)) {
        await this.move(camera, Number(value));
        return;
      }
      if (ids && feature.external_id === ids.feature(CAMERA_KEYS.PRESET)) {
        await this.gotoPreset(camera, Number(value));
        return;
      }
    }
    throw new Error(`No command for ${feature.external_id}`);
  }

  /** "2", "Away", "away" → 2; null when no profile matches. */
  resolveProfile(input) {
    const text = String(input ?? '').trim();
    if (/^\d+$/.test(text)) {
      const number = Number(text);
      return number < PROFILE_COUNT ? number : null;
    }
    const lower = text.toLowerCase();
    const index = (this.server?.profiles ?? []).findIndex(
      (name) => typeof name === 'string' && name.toLowerCase() === lower,
    );
    return index >= 0 ? index : null;
  }

  /** Profile 0 (Inactive), or a profile the configuration lists as disarmed. */
  isDisarmedProfile(number) {
    if (number === INACTIVE_PROFILE) {
      return true;
    }
    const name = this.server?.profiles?.[number]?.toLowerCase();
    return this.config.disarmedProfiles.some((entry) => entry === String(number) || entry === name);
  }

  profileName(number, language = this.language) {
    return this.server?.profiles?.[number] || pick(DEFAULT_NAMES, language).profile(number);
  }

  /** Change the active profile; disarming ones only when allowed. */
  async setProfile(input) {
    const client = this.requireClient();
    const number = this.resolveProfile(input);
    if (number === null) {
      throw new Error(pick(ACTION_TEXT.unknownProfile, this.language));
    }
    if (this.isDisarmedProfile(number) && !this.config.allowDisarm) {
      logger.info(`Profile ${number} refused: disarming from Gladys is off`);
      throw new Error(pick(ACTION_TEXT.disarmRefused, this.language));
    }
    if (!this.rights.changeProfile) {
      throw new Error(pick(ACTION_TEXT.noProfileRight, this.language));
    }
    let data;
    try {
      data = await client.command('status', { profile: number });
      // A profile set once lasts until the schedule's next change ("temporary",
      // lock 2); the same command again holds it (lock 1), as in Blue Iris.
      if (this.config.holdProfile && Number(data?.lock) !== 1) {
        data = await client.command('status', { profile: number });
      }
    } catch (err) {
      throw this.failure(err, `Profile ${number}`);
    }
    logger.info(`Profile set to ${number} (${this.profileName(number, 'en')})`);
    await this.statusChanged(data);
  }

  /** Arm (green) or disarm (red, only when allowed). */
  async setSignal(input) {
    const client = this.requireClient();
    const value = String(input ?? '')
      .trim()
      .toLowerCase();
    if (value === SIGNALS.YELLOW) {
      throw new Error(pick(ACTION_TEXT.yellowRefused, this.language));
    }
    if (![SIGNALS.GREEN, SIGNALS.RED].includes(value)) {
      throw new Error(`Unknown signal ${value}`);
    }
    if (value === SIGNALS.RED && !this.config.allowDisarm) {
      logger.info('Signal red refused: disarming from Gladys is off');
      throw new Error(pick(ACTION_TEXT.disarmRefused, this.language));
    }
    if (!this.rights.changeProfile) {
      throw new Error(pick(ACTION_TEXT.noProfileRight, this.language));
    }
    let data;
    try {
      data = await client.command('status', { signal: SIGNAL_TO_CODE[value] });
    } catch (err) {
      throw this.failure(err, `Signal ${value}`);
    }
    logger.info(`Signal set to ${value}`);
    await this.statusChanged(data);
  }

  /** The status answered by a command: shown at once, read again shortly. */
  async statusChanged(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) && 'signal' in data) {
      this.status = { ...this.status, ...parseStatus(data) };
      await this.publishServerStates();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    this.refreshSoon();
  }

  /** Scene action and widget: trigger a camera, as its "trigger now" button. */
  async triggerCamera(externalId) {
    const camera = this.requireCamera(externalId);
    try {
      await this.client.command('trigger', { camera: camera.short });
    } catch (err) {
      throw this.failure(err, `Trigger of ${camera.name}`);
    }
    logger.info(`Camera ${camera.name} triggered`);
    this.refreshSoon();
  }

  /** Scene action: a fresh image now, sent to Gladys. */
  async refreshSnapshot(externalId) {
    const camera = this.requireCamera(externalId);
    logger.info(`Scene action: fresh image of ${camera.name}`);
    this.images.delete(camera.short);
    const image = await this.cameraImage(camera.short);
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  requirePtz(camera) {
    this.requireClient();
    if (!camera.ptz || !this.rights.ptz) {
      throw new Error(pick(ACTION_TEXT.noPtz, this.language));
    }
  }

  /**
   * A PTZ move (Gladys camera.move): 1-6 starts a movement, bounded by the
   * watchdog; 0 stops it. A new direction stops the previous one first.
   */
  async move(camera, value) {
    this.requirePtz(camera);
    if (value === 0) {
      await this.stopMove(camera.short);
      return;
    }
    const button = MOVE_TO_BUTTON[value];
    if (button === undefined) {
      throw new Error(`Unknown movement ${value}`);
    }
    await this.stopMove(camera.short);
    try {
      await this.client.command('ptz', { camera: camera.short, button, updown: 1 });
    } catch (err) {
      throw this.failure(err, `PTZ of ${camera.name}`);
    }
    logger.info(`PTZ ${camera.name}: move ${value}`);
    const timer = setTimeout(() => {
      this.stopMove(camera.short).catch(() => {});
    }, this.timings.ptzWatchdogMs);
    timer.unref?.();
    this.moves.set(camera.short, { button, timer });
  }

  /** Stop the move of a camera, retried once: it must not keep turning. */
  async stopMove(short) {
    const move = this.moves.get(short);
    if (!move) {
      return;
    }
    this.moves.delete(short);
    clearTimeout(move.timer);
    const args = { camera: short, button: move.button, updown: 0 };
    try {
      await this.client.command('ptz', args);
    } catch {
      try {
        await this.client.command('ptz', args);
      } catch (err) {
        this.problem(`ptz-${short}`, `PTZ stop of ${short} failed: ${err.message}`);
      }
    }
  }

  async stopMoves() {
    await Promise.all([...this.moves.keys()].map((short) => this.stopMove(short)));
  }

  /** Recall a PTZ preset (Gladys camera.preset). */
  async gotoPreset(camera, number) {
    this.requirePtz(camera);
    if (!Number.isInteger(number) || !camera.presets.some((preset) => preset.num === number)) {
      throw new Error(`Unknown preset ${number}`);
    }
    try {
      await this.client.command('ptz', {
        camera: camera.short,
        button: PRESET_BUTTON_BASE + number,
      });
    } catch (err) {
      throw this.failure(err, `Preset of ${camera.name}`);
    }
    logger.info(`PTZ ${camera.name}: preset ${number}`);
  }

  // --- Configuration actions -------------------------------------------------------

  /**
   * "Test the connection": log in again (it also lifts the stop after a
   * refused password), read everything and report, in four languages.
   */
  async testConnection() {
    if (!this.client) {
      return this.connectionStatus().message;
    }
    // One more try of a refused password, asked by the user.
    this.client.unblock();
    await this.refresh({ describe: true });
    const host = this.client.label;
    logger.info(`Connection test: ${this.online ? 'connected' : 'failed'}`);
    if (!this.online) {
      return localized((language) =>
        REPORT_TEXT[language].failed(
          host,
          pick(ERROR_TEXT[this.read.error?.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language),
        ),
      );
    }
    return localized((language) => {
      const text = REPORT_TEXT[language];
      const rights = this.rights.admin
        ? text.rights.admin
        : this.rights.changeProfile
          ? text.rights.profile
          : text.rights.read;
      const profile = this.status?.profile;
      return [
        text.ok(
          this.server.systemName ?? 'Blue Iris',
          host,
          this.cameras.size,
          profile === null || profile === undefined ? '?' : this.profileName(profile, language),
        ),
        text.user(this.server.user ?? this.config.server.username, rights),
      ].join(' ');
    });
  }

  // --- Widget ------------------------------------------------------------------------

  /** What the widget shows: the server, the cameras and the alerts. */
  view() {
    return {
      configured: Boolean(this.client),
      online: this.online,
      error: this.read.error,
      status: this.status,
      rights: this.rights,
      allowDisarm: Boolean(this.config?.allowDisarm),
      profileName: (number, language) => this.profileName(number, language),
      cameras: [...this.cameras.values()].map((camera) => ({
        ...camera,
        online: this.online && Boolean(this.live.get(camera.short)?.online),
        triggered: this.online && Boolean(this.live.get(camera.short)?.triggered),
        externalId: cameraIds(this.gladys, camera.short).device,
      })),
      alerts: this.alerts,
      alertsToday: (short) => this.alertsToday(short),
    };
  }

  /** The raw base64 of an alert image of the widget. */
  thumbnail(key) {
    const image = this.thumbnails.get(key);
    if (!image) {
      throw new Error(`Unknown image ${key}`);
    }
    return image;
  }
}
