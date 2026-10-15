// -----------------------------------------------------------------------------
// What the answers of Blue Iris mean. Field names and flags as Blue Iris sends
// them, checked against its own web interface (UI3, bp2008/ui3) and the Home
// Assistant integrations (elad-bar/ha-blueiris, kramttocs/ha-blueiris):
//
//   status   signal ("0" red, "1" green, "2" yellow), profile (0-7), lock
//            (0 the schedule runs, 1 held, 2 temporary), cpu (%), disks
//            [{ disk, allocated, used, free, total }] in MiB, or an older
//            `clips` text "…, 1.2T/2.0T; …".
//   camlist  one entry per camera and per group: optionValue (short name, the
//            id of every command), optionDisplay (name), isEnabled, isOnline,
//            isMotion, isTriggered, isAlerting, ptz, audio, alertutc (epoch s
//            of the last alert), newalerts, group (members, groups only).
//   alertlist records { camera, path, date (epoch s), flags, memo, … }; the
//            flags say what raised the alert (motion, audio, external…) and
//            what the AI confirmed (person, vehicle); memo holds the AI
//            labels, e.g. "person:87%,car:62%".
//   ptz      (no button) { presetnum, presets: names or { num, desc } }.
// -----------------------------------------------------------------------------

// Shield signal of Blue Iris ("traffic light"): permanent values once published.
export const SIGNALS = Object.freeze({ RED: 'red', GREEN: 'green', YELLOW: 'yellow' });
const SIGNAL_CODES = { 0: SIGNALS.RED, 1: SIGNALS.GREEN, 2: SIGNALS.YELLOW };
export const SIGNAL_TO_CODE = { [SIGNALS.RED]: 0, [SIGNALS.GREEN]: 1, [SIGNALS.YELLOW]: 2 };

// Blue Iris has 8 profiles; 0 is "Inactive", in which cameras do not trigger.
export const PROFILE_COUNT = 8;
export const INACTIVE_PROFILE = 0;

// What an alert was: values of the `detection` filter of the camera_alert
// trigger, permanent once published.
export const DETECTIONS = Object.freeze({
  PERSON: 'person',
  VEHICLE: 'vehicle',
  ANIMAL: 'animal',
  MOTION: 'motion',
  AUDIO: 'audio',
  EXTERNAL: 'external',
  OTHER: 'other',
});

// Flags of an alert record (UI3, BIDBFLAG).
export const ALERT_FLAGS = Object.freeze({
  MOTION: 1 << 17,
  ONVIF: 1 << 18,
  AUDIO: 1 << 19,
  EXTERNAL: 1 << 20,
  DIO: 1 << 21,
  GROUP: 1 << 22,
  CANCELLED: 1 << 23,
  NOSIGNAL: 1 << 24,
  AI_PERSON: 1 << 26,
  AI_VEHICLE: 1 << 27,
  AI_CONFIRMED: 1 << 28,
});

// AI labels (CodeProject.AI, DeepStack: the COCO names) by kind.
export const AI_LABELS = {
  [DETECTIONS.PERSON]: ['person', 'people', 'face'],
  [DETECTIONS.VEHICLE]: [
    'car',
    'truck',
    'bus',
    'motorcycle',
    'motorbike',
    'bicycle',
    'vehicle',
    'van',
    'boat',
  ],
  [DETECTIONS.ANIMAL]: [
    'animal',
    'dog',
    'cat',
    'bird',
    'horse',
    'sheep',
    'cow',
    'bear',
    'deer',
    'fox',
    'rabbit',
    'squirrel',
    'raccoon',
  ],
};

// Gladys camera.move values (CAMERA_MOVE) → Blue Iris PTZ buttons.
export const MOVE_TO_BUTTON = Object.freeze({ 1: 0, 2: 1, 3: 2, 4: 3, 5: 5, 6: 6 });
export const PRESET_BUTTON_BASE = 100;
// System entries of the camera list: all cameras, the cycle.
const SYSTEM_CAMERAS = new Set(['index', '@index']);

const bool = (value) => value === true || value === 1 || value === '1' || value === 'true';

const number = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value, digits = 1) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

const SIZE_UNITS = { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40, P: 2 ** 50 };

/** "1.23T" → bytes. */
export function parseSize(text) {
  const match = String(text ?? '')
    .trim()
    .match(/^([\d.]+)\s*([KMGTP])?B?$/i);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value * (SIZE_UNITS[match[2]?.toUpperCase()] ?? 1) : null;
}

const MIB = 2 ** 20;
const GIB = 2 ** 30;

/**
 * The `status` answer.
 * @returns {{ signal, profile, lock, cpu, diskUsedPercent, diskFreeGb, schedule }}
 */
export function parseStatus(data = {}) {
  const source = data && typeof data === 'object' ? data : {};
  const signalCode = number(source.signal);
  const profile = number(source.profile);
  let diskUsedPercent = null;
  let diskFreeGb = null;
  if (Array.isArray(source.disks) && source.disks.length > 0) {
    let allocated = 0;
    let used = 0;
    let free = 0;
    let freeKnown = false;
    for (const disk of source.disks) {
      allocated += number(disk?.allocated) ?? 0;
      used += number(disk?.used) ?? 0;
      const diskFree = number(disk?.free);
      if (diskFree !== null) {
        free += diskFree;
        freeKnown = true;
      }
    }
    if (allocated > 0) {
      diskUsedPercent = round(Math.min(100, (used / allocated) * 100));
    }
    if (freeKnown) {
      diskFreeGb = round((free * MIB) / GIB);
    }
  } else if (typeof source.clips === 'string') {
    // Older servers: "Clips: 123 items, 1.23T/2.00T; D: +108.6G".
    const match = source.clips.match(/,\s*([\d.]+\s*[KMGTP]?)B?\s*\/\s*([\d.]+\s*[KMGTP]?)B?\s*;/i);
    if (match) {
      const used = parseSize(match[1]);
      const total = parseSize(match[2]);
      if (used !== null && total) {
        diskUsedPercent = round(Math.min(100, (used / total) * 100));
        diskFreeGb = round(Math.max(0, total - used) / GIB);
      }
    }
  }
  const cpu = number(source.cpu);
  return {
    signal: SIGNAL_CODES[signalCode] ?? null,
    profile: Number.isInteger(profile) && profile >= 0 && profile < PROFILE_COUNT ? profile : null,
    lock: number(source.lock),
    cpu: cpu === null ? null : round(Math.min(100, Math.max(0, cpu))),
    diskUsedPercent,
    diskFreeGb,
    schedule: typeof source.schedule === 'string' ? source.schedule : null,
  };
}

/** The camera name Blue Iris shows (a leading "+" marks a group member in old lists). */
const cleanName = (value, fallback) =>
  String(value ?? fallback)
    .replace(/^\++/, '')
    .trim();

/**
 * The cameras of a `camlist` answer, groups and system entries left out.
 * @returns {Array<object>}
 */
export function parseCameras(data) {
  if (!Array.isArray(data)) {
    return [];
  }
  const cameras = [];
  const seen = new Set();
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const short = typeof entry.optionValue === 'string' ? entry.optionValue.trim() : '';
    if (
      !short ||
      seen.has(short) ||
      SYSTEM_CAMERAS.has(short) ||
      short.startsWith('@') ||
      Array.isArray(entry.group) ||
      bool(entry.isFakeGroup)
    ) {
      continue;
    }
    seen.add(short);
    const enabled = entry.isEnabled === undefined ? true : bool(entry.isEnabled);
    const alertUtc = number(entry.alertutc);
    cameras.push({
      short,
      name: cleanName(entry.optionDisplay, short) || short,
      enabled,
      online: enabled && bool(entry.isOnline) && !bool(entry.isNoSignal),
      motion: bool(entry.isMotion),
      triggered: bool(entry.isTriggered),
      alerting: bool(entry.isAlerting),
      ptz: bool(entry.ptz),
      audio: bool(entry.audio),
      // null: a server too old to send it (the hub then watches the triggers).
      alertUtc,
      newAlerts: number(entry.newalerts),
    });
  }
  return cameras;
}

/** The AI labels of a memo: "person:87%,car:62%" → ['person', 'car']. */
export function memoLabels(memo) {
  if (typeof memo !== 'string' || !memo.trim()) {
    return [];
  }
  const labels = new Set();
  for (const token of memo.toLowerCase().split(/[,;|/\s]+/)) {
    const label = token
      .replace(/[([{].*$/, '')
      .replace(/[:=].*$/, '')
      .replace(/[^a-z_]/g, '');
    if (label) {
      labels.add(label);
    }
  }
  return [...labels];
}

/**
 * What one alert record was.
 * @returns {{ camera, at, path, memo, kinds: string[], cancelled: boolean } | null}
 *   `kinds` lists every detection, the most telling first.
 */
export function parseAlert(record) {
  if (!record || typeof record !== 'object' || typeof record.camera !== 'string') {
    return null;
  }
  const date = number(record.date);
  if (date === null) {
    return null;
  }
  const flags = number(record.flags) ?? 0;
  const memo = typeof record.memo === 'string' ? record.memo.trim() : '';
  const labels = new Set(memoLabels(memo));
  const has = (flag) => (flags & flag) !== 0;
  const byLabel = (kind) => AI_LABELS[kind].some((label) => labels.has(label));
  const kinds = [];
  if (has(ALERT_FLAGS.AI_PERSON) || byLabel(DETECTIONS.PERSON)) {
    kinds.push(DETECTIONS.PERSON);
  }
  if (has(ALERT_FLAGS.AI_VEHICLE) || byLabel(DETECTIONS.VEHICLE)) {
    kinds.push(DETECTIONS.VEHICLE);
  }
  if (byLabel(DETECTIONS.ANIMAL)) {
    kinds.push(DETECTIONS.ANIMAL);
  }
  if (has(ALERT_FLAGS.AUDIO)) {
    kinds.push(DETECTIONS.AUDIO);
  }
  if (has(ALERT_FLAGS.EXTERNAL) || has(ALERT_FLAGS.ONVIF) || has(ALERT_FLAGS.DIO)) {
    kinds.push(DETECTIONS.EXTERNAL);
  }
  if (has(ALERT_FLAGS.MOTION)) {
    kinds.push(DETECTIONS.MOTION);
  }
  if (kinds.length === 0) {
    kinds.push(DETECTIONS.OTHER);
  }
  return {
    camera: record.camera,
    at: date * 1000,
    path: typeof record.path === 'string' ? record.path : null,
    memo,
    kinds,
    cancelled: has(ALERT_FLAGS.CANCELLED),
  };
}

/** The records of an `alertlist` answer, oldest first. */
export function parseAlerts(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.alerts)
      ? data.alerts
      : Array.isArray(data?.items)
        ? data.items
        : [];
  return list
    .map(parseAlert)
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
}

// Presets shown when the camera names none (Blue Iris counts them, unnamed).
export const MAX_UNNAMED_PRESETS = 8;

/**
 * The presets of a `ptz` answer (no button): the named ones, else the first
 * `presetnum` (8 at most) unnamed.
 * @returns {Array<{ num: number, name: string | null }>}
 */
export function parsePresets(data) {
  const source = data && typeof data === 'object' ? data : {};
  const count = number(source.presetnum) ?? 0;
  const named = new Map();
  if (Array.isArray(source.presets)) {
    source.presets.forEach((entry, index) => {
      const num = typeof entry === 'object' && entry ? number(entry.num) : index + 1;
      const raw = typeof entry === 'object' && entry ? entry.desc : entry;
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (
        Number.isInteger(num) &&
        num >= 1 &&
        num <= 99 &&
        name &&
        name !== '(undefined)' &&
        !/^preset\s*\d+$/i.test(name)
      ) {
        named.set(num, name.slice(0, 40));
      }
    });
  }
  if (named.size > 0) {
    return [...named.entries()].sort(([a], [b]) => a - b).map(([num, name]) => ({ num, name }));
  }
  const unnamed = Math.min(Math.max(0, Math.floor(count)), MAX_UNNAMED_PRESETS);
  return Array.from({ length: unnamed }, (_, index) => ({ num: index + 1, name: null }));
}

/**
 * The rights of the logged-in user, from the login data (as UI3 reads them).
 */
export function parseRights(info = {}) {
  const source = info && typeof info === 'object' ? info : {};
  const admin = bool(source.admin);
  const maybe = (value, fallback) =>
    value === undefined || value === null ? fallback : bool(value);
  return {
    admin,
    changeProfile: maybe(source.changeprofile, admin),
    ptz: maybe(source.ptz, true),
  };
}

/** The 8 profile names of the login data (the missing ones numbered). */
export function parseProfiles(info = {}) {
  const names = Array.isArray(info?.profiles) ? info.profiles : [];
  return Array.from({ length: PROFILE_COUNT }, (_, index) => {
    const name = typeof names[index] === 'string' ? names[index].trim() : '';
    return name || null;
  });
}

/** The identity of the server, from the login data. */
export function parseServerInfo(info = {}) {
  const source = info && typeof info === 'object' ? info : {};
  const text = (key) =>
    typeof source[key] === 'string' && source[key].trim() ? source[key].trim() : null;
  return {
    systemName: text('system name'),
    version: text('version'),
    user: text('user'),
    rights: parseRights(source),
    profiles: parseProfiles(source),
  };
}
