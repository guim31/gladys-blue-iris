// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Blue Iris server per integration: its address, its web server port
// (81 by default in Blue Iris), HTTP or HTTPS, a user name and a password.
// The password lives in a `secret` field only: an address carrying
// credentials (`user:pass@host`) is refused rather than kept in a plain text
// field.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of the server (status and camera list). Blue Iris
// is a local server with no quota: its own web interface (UI3) reads the
// status every few seconds. Motion and triggers are seen at this pace.
export const REFRESH_INTERVALS = ['5', '10', '30', '60'];

// Minutes between two images of every camera added to Gladys (`0`: only on an
// alert or on demand). The dashboard camera box shows the last image the
// integration published.
export const SNAPSHOT_INTERVALS = ['0', '1', '5', '15', '60'];

export const DEFAULT_PORT = 81;

export const DEFAULT_CONFIG = {
  host: '',
  port: DEFAULT_PORT,
  use_https: false,
  username: '',
  password: '',
  refresh_interval: '10',
  snapshot_interval: '5',
  hold_profile: true,
  allow_disarm: false,
  disarmed_profiles: '',
  language: 'fr',
};

// A host name or an IPv4 address; an IPv6 address goes between brackets.
const HOST_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const validPort = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;

/**
 * The server address as typed: `192.0.2.20`, `192.0.2.20:8081`,
 * `https://bi.lan`, `[2001:db8::20]`. A port in the address wins over the
 * port field, a scheme over the HTTPS box.
 * @returns {{ origin: string, label: string } | null} null when unusable
 */
export function parseServer(raw, { port = DEFAULT_PORT, https = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text || text.includes('@')) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `${https ? 'https' : 'http'}://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  if (!['/', ''].includes(url.pathname) || url.search || url.hash) {
    return null;
  }
  const host = url.hostname;
  const ipv6 = host.startsWith('[') && host.endsWith(']');
  if (!ipv6 && !HOST_PATTERN.test(host)) {
    return null;
  }
  if (!url.port) {
    const fallback = validPort(port) ? port : DEFAULT_PORT;
    const standard = url.protocol === 'https:' ? 443 : 80;
    if (fallback !== standard) {
      url.port = String(fallback);
    }
  }
  return { origin: url.origin, label: url.port ? `${host}:${url.port}` : host };
}

/**
 * The profiles the user calls "disarmed", besides profile 0 (Inactive, the
 * profile in which Blue Iris cameras do not trigger): names or numbers,
 * separated by commas or semicolons, compared without case.
 */
export function parseProfileList(raw) {
  const text = typeof raw === 'string' ? raw : '';
  return [
    ...new Set(
      text
        .split(/[,;\n]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const pickOption = (value, options, fallback) =>
  options.includes(String(value ?? '')) ? String(value) : fallback;

// A boolean field may arrive as a string from older form engines.
const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {object} `server` is null until the address, user name and
 *   password are usable; `problem` then says which is missing.
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  // A password may legitimately start or end with a space: kept as typed.
  const password = typeof source.password === 'string' ? source.password : '';
  const port = Number(source.port);
  const https = flag(source.use_https, DEFAULT_CONFIG.use_https);
  const typed = text('host');
  const address = typed ? parseServer(typed, { port, https }) : null;
  const username = text('username');

  let problem = null;
  if (!typed) {
    problem = 'noHost';
  } else if (!address) {
    problem = 'invalidHost';
  } else if (!username || !password) {
    problem = 'noCredentials';
  }
  const language = text('language');
  return {
    server: problem ? null : { ...address, username, password },
    problem,
    refreshMs:
      Number(
        pickOption(source.refresh_interval, REFRESH_INTERVALS, DEFAULT_CONFIG.refresh_interval),
      ) * 1000,
    snapshotIntervalMs:
      Number(
        pickOption(source.snapshot_interval, SNAPSHOT_INTERVALS, DEFAULT_CONFIG.snapshot_interval),
      ) * 60_000,
    holdProfile: flag(source.hold_profile, DEFAULT_CONFIG.hold_profile),
    allowDisarm: flag(source.allow_disarm, DEFAULT_CONFIG.allow_disarm),
    disarmedProfiles: parseProfileList(source.disarmed_profiles),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}
