// -----------------------------------------------------------------------------
// The Gladys devices: the Blue Iris server, and one device per camera.
//
// Identity: one server per integration, so the server is `…:server:server`
// (its system name can change, its address too: neither is an identity). A
// camera is its Blue Iris short name (`optionValue`), the id every command of
// the JSON interface takes: `gladys.externalIds('camera', <short name>)`.
// Feature keys are permanent once published (test/gladys-rules.test.js checks
// the couples against the core table).
//
// Server features:
//   online      input/binary                        the JSON interface answers
//   profile     text/select                         active profile (0-7), a command
//   signal      text/select                         shield: green, yellow, red, a command
//   cpu         level-sensor/liquid-level-percent   CPU load of the server
//   disk_used   level-sensor/liquid-level-percent   clip storage used
//   disk_free   data/size (GB)                      free space of the clip disks
// Camera features:
//   image       camera/image                        snapshots
//   online      input/binary                        enabled and receiving video
//   motion      motion-sensor/binary                Blue Iris sees motion
//   triggered   motion-sensor/binary                the camera is triggered
//   person      motion-sensor/binary                an alert confirmed a person (AI)
//   vehicle     motion-sensor/binary                an alert confirmed a vehicle (AI)
//   move        camera/move                         PTZ, when the camera has it
//   preset      camera/preset                       PTZ presets, when it has some
// "Online" is input/binary: presence-sensor/binary would read "Presence
// detected" on a camera. Person and vehicle appear once Blue Iris reported
// one (its AI is optional): learned, kept in /data. The percentages are
// level-sensor/liquid-level-percent, the core has no generic percent.
//
// Disarming is never a switch: profile and signal are selects whose
// disarming choices are refused unless the configuration allows them.
//
// The devices are published with should_poll: false: the integration reads
// Blue Iris on its own timer (src/hub.js), never waiting for Gladys to poll
// (GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { PROFILE_COUNT, SIGNALS } from './blueiris/model.js';

export const SERVER_TYPE = 'server';
export const SERVER_PLATFORM_ID = 'server';
export const CAMERA_TYPE = 'camera';

// Suffixes of the feature external ids: permanent once published.
export const SERVER_KEYS = Object.freeze({
  ONLINE: 'online',
  PROFILE: 'profile',
  SIGNAL: 'signal',
  CPU: 'cpu',
  DISK_USED: 'disk_used',
  DISK_FREE: 'disk_free',
});

export const CAMERA_KEYS = Object.freeze({
  IMAGE: 'image',
  ONLINE: 'online',
  MOTION: 'motion',
  TRIGGERED: 'triggered',
  PERSON: 'person',
  VEHICLE: 'vehicle',
  MOVE: 'move',
  PRESET: 'preset',
});

// The camera features that appear once Blue Iris reported them.
export const LEARNABLE = Object.freeze([CAMERA_KEYS.PERSON, CAMERA_KEYS.VEHICLE]);

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const SERVER_NAMES = {
  en: {
    online: 'Online',
    profile: 'Profile',
    signal: 'Arming signal',
    cpu: 'CPU load',
    disk_used: 'Storage used',
    disk_free: 'Free space',
  },
  fr: {
    online: 'En ligne',
    profile: 'Profil',
    signal: "Signal d'armement",
    cpu: 'Charge CPU',
    disk_used: 'Stockage utilisé',
    disk_free: 'Espace libre',
  },
  de: {
    online: 'Online',
    profile: 'Profil',
    signal: 'Scharfschaltung',
    cpu: 'CPU-Last',
    disk_used: 'Belegter Speicher',
    disk_free: 'Freier Speicher',
  },
  es: {
    online: 'En línea',
    profile: 'Perfil',
    signal: 'Señal de armado',
    cpu: 'Carga de CPU',
    disk_used: 'Almacenamiento usado',
    disk_free: 'Espacio libre',
  },
};

export const CAMERA_NAMES = {
  en: {
    image: 'Image',
    online: 'Online',
    motion: 'Motion',
    triggered: 'Triggered',
    person: 'Person',
    vehicle: 'Vehicle',
    move: 'Pan, tilt, zoom',
    preset: 'Preset position',
  },
  fr: {
    image: 'Image',
    online: 'En ligne',
    motion: 'Mouvement',
    triggered: 'Déclenchée',
    person: 'Personne',
    vehicle: 'Véhicule',
    move: 'Orientation (PTZ)',
    preset: 'Position mémorisée',
  },
  de: {
    image: 'Bild',
    online: 'Online',
    motion: 'Bewegung',
    triggered: 'Ausgelöst',
    person: 'Person',
    vehicle: 'Fahrzeug',
    move: 'Schwenken, Neigen, Zoom',
    preset: 'Gespeicherte Position',
  },
  es: {
    image: 'Imagen',
    online: 'En línea',
    motion: 'Movimiento',
    triggered: 'Activada',
    person: 'Persona',
    vehicle: 'Vehículo',
    move: 'Orientación (PTZ)',
    preset: 'Posición guardada',
  },
};

// Options of the signal select (values permanent once published).
export const SIGNAL_NAMES = {
  en: { green: 'Armed (green)', yellow: 'Arming (yellow)', red: 'Disarmed (red)' },
  fr: { green: 'Armé (vert)', yellow: 'Armement (jaune)', red: 'Désarmé (rouge)' },
  de: { green: 'Scharf (grün)', yellow: 'Wird scharf (gelb)', red: 'Unscharf (rot)' },
  es: { green: 'Armado (verde)', yellow: 'Armando (amarillo)', red: 'Desarmado (rojo)' },
};

// Labels of the movements (the dashboard draws arrows; scenes show these).
export const MOVE_NAMES = {
  en: ['Pan left', 'Pan right', 'Tilt up', 'Tilt down', 'Zoom in', 'Zoom out'],
  fr: ['Gauche', 'Droite', 'Haut', 'Bas', 'Zoom avant', 'Zoom arrière'],
  de: ['Links', 'Rechts', 'Hoch', 'Runter', 'Hineinzoomen', 'Herauszoomen'],
  es: ['Izquierda', 'Derecha', 'Arriba', 'Abajo', 'Acercar', 'Alejar'],
};

// Names given to what Blue Iris left unnamed.
export const DEFAULT_NAMES = {
  en: { server: 'Blue Iris', profile: (n) => `Profile ${n}`, preset: (n) => `Preset ${n}` },
  fr: { server: 'Blue Iris', profile: (n) => `Profil ${n}`, preset: (n) => `Position ${n}` },
  de: { server: 'Blue Iris', profile: (n) => `Profil ${n}`, preset: (n) => `Position ${n}` },
  es: { server: 'Blue Iris', profile: (n) => `Perfil ${n}`, preset: (n) => `Posición ${n}` },
};

const pickLanguage = (table, language) => table[language] ?? table.en;

const sensor = (category) => ({
  category,
  type: TYPE.SENSOR.BINARY,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
});

const percent = () => ({
  category: CATEGORY.LEVEL_SENSOR,
  type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
  unit: UNIT.PERCENT,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 100,
});

const select = (readOnly) => ({
  category: CATEGORY.TEXT,
  type: TYPE.TEXT.SELECT,
  read_only: readOnly,
  has_feedback: true,
  keep_history: true,
  // NOT NULL in Gladys even for a text feature.
  min: 0,
  max: 0,
});

// Free space bound: 1 PB of clip disks.
const MAX_FREE_GB = 1_000_000;

/** The profile options: "0" to "7", named as in Blue Iris. */
export function profileOptions(profiles, language) {
  const names = pickLanguage(DEFAULT_NAMES, language);
  return Array.from({ length: PROFILE_COUNT }, (_, index) => ({
    value: String(index),
    label: (profiles?.[index] || names.profile(index)).slice(0, 60),
    sort_order: index,
  }));
}

export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_PLATFORM_ID);

/** Short names are free text in Blue Iris: keep what an id can hold. */
export const cameraPlatformId = (short) => String(short).replace(/[^A-Za-z0-9_-]/g, '_');

export const cameraIds = (gladys, short) =>
  gladys.externalIds(CAMERA_TYPE, cameraPlatformId(short));

/**
 * The discovery payload of the server.
 * @param {object} gladys SDK client
 * @param {object} server { systemName, version, label, profiles, rights }
 * @param {object} [options] { language }
 */
export function buildServerDevice(gladys, server, { language = 'en' } = {}) {
  const ids = serverIds(gladys);
  const names = pickLanguage(SERVER_NAMES, language);
  const signals = pickLanguage(SIGNAL_NAMES, language);
  const canChange = Boolean(server.rights?.changeProfile);
  const definitions = {
    [SERVER_KEYS.ONLINE]: sensor(CATEGORY.INPUT),
    [SERVER_KEYS.PROFILE]: {
      ...select(!canChange),
      supported_options: profileOptions(server.profiles, language),
    },
    [SERVER_KEYS.SIGNAL]: {
      ...select(!canChange),
      supported_options: [SIGNALS.GREEN, SIGNALS.YELLOW, SIGNALS.RED].map((value, index) => ({
        value,
        label: signals[value],
        sort_order: index,
      })),
    },
    [SERVER_KEYS.CPU]: percent(),
    [SERVER_KEYS.DISK_USED]: percent(),
    [SERVER_KEYS.DISK_FREE]: {
      category: CATEGORY.DATA,
      type: TYPE.DATA.SIZE,
      unit: UNIT.GIGABYTE,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: MAX_FREE_GB,
    },
  };
  return {
    name: server.systemName || pickLanguage(DEFAULT_NAMES, language).server,
    external_id: ids.device,
    model: server.version ? `Blue Iris ${server.version}` : 'Blue Iris',
    should_poll: false,
    params: [{ name: 'host', value: server.label }],
    features: Object.values(SERVER_KEYS).map((key) => ({
      ...definitions[key],
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The feature keys of a camera, in display order.
 * @param {object} camera { ptz, presets, learned: Set }
 * @param {object} rights { ptz }
 */
export function cameraFeatureKeys(camera, rights = {}) {
  const learned = camera.learned ?? new Set();
  const ptz = Boolean(camera.ptz && rights.ptz);
  return [
    CAMERA_KEYS.IMAGE,
    CAMERA_KEYS.ONLINE,
    CAMERA_KEYS.MOTION,
    CAMERA_KEYS.TRIGGERED,
    learned.has(CAMERA_KEYS.PERSON) && CAMERA_KEYS.PERSON,
    learned.has(CAMERA_KEYS.VEHICLE) && CAMERA_KEYS.VEHICLE,
    ptz && CAMERA_KEYS.MOVE,
    ptz && camera.presets?.length > 0 && CAMERA_KEYS.PRESET,
  ].filter(Boolean);
}

/**
 * The discovery payload of a camera.
 * @param {object} gladys SDK client
 * @param {object} camera { short, name, ptz, presets, learned }
 * @param {object} [options] { language, rights }
 */
export function buildCameraDevice(gladys, camera, { language = 'en', rights = {} } = {}) {
  const ids = cameraIds(gladys, camera.short);
  const names = pickLanguage(CAMERA_NAMES, language);
  const moves = pickLanguage(MOVE_NAMES, language);
  const defaults = pickLanguage(DEFAULT_NAMES, language);
  const presets = camera.presets ?? [];
  const definitions = {
    [CAMERA_KEYS.IMAGE]: {
      category: CATEGORY.CAMERA,
      type: TYPE.CAMERA.IMAGE,
      read_only: true,
      has_feedback: false,
      // Images travel on their own channel, never in the states history.
      keep_history: false,
      min: 0,
      max: 0,
    },
    [CAMERA_KEYS.ONLINE]: sensor(CATEGORY.INPUT),
    [CAMERA_KEYS.MOTION]: sensor(CATEGORY.MOTION_SENSOR),
    [CAMERA_KEYS.TRIGGERED]: sensor(CATEGORY.MOTION_SENSOR),
    [CAMERA_KEYS.PERSON]: sensor(CATEGORY.MOTION_SENSOR),
    [CAMERA_KEYS.VEHICLE]: sensor(CATEGORY.MOTION_SENSOR),
    // docs/specs/camera-ptz-control.md of the core: one command feature,
    // 0 = stop (never listed), 1-6 the movements.
    [CAMERA_KEYS.MOVE]: {
      category: CATEGORY.CAMERA,
      type: TYPE.CAMERA.MOVE,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 6,
      supported_options: moves.map((label, index) => ({
        value: index + 1,
        label,
        sort_order: index,
      })),
    },
    [CAMERA_KEYS.PRESET]: {
      category: CATEGORY.CAMERA,
      type: TYPE.CAMERA.PRESET,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: Math.max(0, ...presets.map((preset) => preset.num)),
      supported_options: presets.map((preset, index) => ({
        value: preset.num,
        label: preset.name || defaults.preset(preset.num),
        sort_order: index,
      })),
    },
  };
  return {
    name: camera.name,
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'short_name', value: camera.short }],
    features: cameraFeatureKeys(camera, rights).map((key) => ({
      ...definitions[key],
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

const flag = (value) => (value ? 1 : 0);

/**
 * The values of the server features (null: nothing to publish). Text values
 * are `{ text }`.
 * @param {object|null} status parseStatus() result, null when unreachable
 * @param {boolean} online
 */
export function serverValues(status, online) {
  const known = online && status ? status : {};
  return {
    [SERVER_KEYS.ONLINE]: flag(online),
    [SERVER_KEYS.PROFILE]:
      known.profile === null || known.profile === undefined
        ? null
        : { text: String(known.profile) },
    [SERVER_KEYS.SIGNAL]: known.signal ? { text: known.signal } : null,
    [SERVER_KEYS.CPU]: known.cpu ?? null,
    [SERVER_KEYS.DISK_USED]: known.diskUsedPercent ?? null,
    [SERVER_KEYS.DISK_FREE]:
      known.diskFreeGb === null || known.diskFreeGb === undefined
        ? null
        : Math.min(MAX_FREE_GB, known.diskFreeGb),
  };
}

/**
 * The values of the camera features.
 * @param {object|null} live the camera of the last camera list, null when unknown
 * @param {Set<string>} detected the AI detections active on the camera
 * @param {boolean} serverOnline
 */
export function cameraValues(live, detected, serverOnline) {
  const known = serverOnline && live ? live : null;
  return {
    [CAMERA_KEYS.ONLINE]: flag(known?.online),
    [CAMERA_KEYS.MOTION]: flag(known?.motion),
    [CAMERA_KEYS.TRIGGERED]: flag(known?.triggered),
    [CAMERA_KEYS.PERSON]: flag(known && detected.has(CAMERA_KEYS.PERSON)),
    [CAMERA_KEYS.VEHICLE]: flag(known && detected.has(CAMERA_KEYS.VEHICLE)),
  };
}
