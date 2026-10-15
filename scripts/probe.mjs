#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Blue Iris server, with the very client of the
// integration: what the integration would see, without Gladys.
//
//   BLUE_IRIS_PASSWORD=… node scripts/probe.mjs <address> [user] [port]
//
// It logs in, reads the status, the cameras, the alerts of the last 24 hours,
// the PTZ presets, and one image per size step of the first online camera,
// then logs out. It writes nothing: no profile, no signal, no trigger, no PTZ
// move. It prints the field NAMES Blue Iris sends (to check the integration's
// assumptions), never a password, a session id, the license, nor the
// addresses of the cameras. One refused password stops it at once: Blue Iris
// can ban an address after a few.
//
// Not part of the Docker image (only index.js and src/ are copied).
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, parseServer } from '../src/config.js';
import { BlueIrisClient } from '../src/blueiris/client.js';
import {
  parseAlerts,
  parseCameras,
  parsePresets,
  parseServerInfo,
  parseStatus,
} from '../src/blueiris/model.js';
import { IMAGE_STEPS, fitsCamera } from '../src/image.js';

const [address, user = 'gladys', port = String(DEFAULT_PORT)] = process.argv.slice(2);
const password = process.env.BLUE_IRIS_PASSWORD ?? '';
const target = parseServer(address, { port: Number(port) });
if (!target || !password) {
  console.error('Usage: BLUE_IRIS_PASSWORD=… node scripts/probe.mjs <address> [user] [port]');
  process.exit(2);
}

const line = (label, value) => console.log(`${label.padEnd(22)} ${value}`);
const keys = (object) =>
  object && typeof object === 'object' ? Object.keys(object).sort().join(', ') : String(object);
// Values never printed, even as field names' examples.
const HIDDEN = new Set(['license', 'support', 'ip', 'session', 'latitude', 'longitude']);
const fields = (object) =>
  keys(Object.fromEntries(Object.entries(object ?? {}).filter(([key]) => !HIDDEN.has(key)))) +
  (Object.keys(object ?? {}).some((key) => HIDDEN.has(key)) ? ' (+ hidden fields)' : '');

const client = new BlueIrisClient({ server: { ...target, username: user, password } });

let info;
try {
  info = await client.login();
} catch (err) {
  console.error(`Cannot log in to ${target.label}: ${err.message} (${err.kind ?? 'error'})`);
  process.exit(1);
}

const server = parseServerInfo(info);
line('Address', target.label);
line('System name', server.systemName ?? '?');
line('Version', server.version ?? '?');
line(
  'Rights',
  `admin ${server.rights.admin}, change profile ${server.rights.changeProfile}, PTZ ${server.rights.ptz}`,
);
line('Profiles', server.profiles.map((name, index) => `${index}=${name ?? '?'}`).join(', '));
line('Login fields', fields(info));

try {
  const raw = await client.command('status');
  line('Status fields', fields(raw));
  line('Status', JSON.stringify(parseStatus(raw)));
} catch (err) {
  line('Status', `not read: ${err.message}`);
}

let cameras = [];
try {
  const raw = await client.command('camlist');
  const first = Array.isArray(raw) ? raw.find((entry) => !Array.isArray(entry?.group)) : null;
  line('Camera fields', fields(first));
  cameras = parseCameras(raw);
  for (const camera of cameras) {
    line(
      `Camera ${camera.short}`,
      `${camera.name}: online ${camera.online}, motion ${camera.motion}, triggered ${camera.triggered}, ` +
        `PTZ ${camera.ptz}, last alert ${camera.alertUtc ? new Date(camera.alertUtc * 1000).toISOString() : 'none'}`,
    );
  }
} catch (err) {
  line('Cameras', `not read: ${err.message}`);
}

try {
  const now = Math.floor(Date.now() / 1000);
  const raw = await client.command('alertlist', {
    camera: 'index',
    view: 'alerts',
    startdate: now - 24 * 3600,
    enddate: now + 3600,
  });
  const records = Array.isArray(raw) ? raw : [];
  line('Alert fields', fields(records[0]));
  const alerts = parseAlerts(raw);
  const kinds = {};
  for (const alert of alerts) {
    kinds[alert.kinds[0]] = (kinds[alert.kinds[0]] ?? 0) + 1;
  }
  line('Alerts 24 h', `${alerts.length} ${JSON.stringify(kinds)}`);
  const sample = alerts.findLast((alert) => alert.memo);
  if (sample) {
    line('Last AI memo', `${sample.memo} → ${sample.kinds.join(', ')}`);
  }
} catch (err) {
  line('Alerts', `not read: ${err.message}`);
}

for (const camera of cameras.filter((entry) => entry.ptz)) {
  try {
    const raw = await client.command('ptz', { camera: camera.short });
    line(`PTZ ${camera.short}`, JSON.stringify(parsePresets(raw)));
  } catch (err) {
    line(`PTZ ${camera.short}`, `not read: ${err.message}`);
  }
}

const online = cameras.find((camera) => camera.online);
if (online) {
  for (const step of IMAGE_STEPS) {
    try {
      const started = Date.now();
      const bytes = await client.image(online.short, step);
      line(
        `Image ${step.width} q${step.quality}`,
        `${Math.round(bytes.length / 1024)} KB${fitsCamera(bytes) ? ' (fits Gladys)' : ''}, ${Date.now() - started} ms`,
      );
    } catch (err) {
      line(`Image ${step.width}`, `failed: ${err.message}`);
    }
  }
}

await client.logout();
console.log('Done.');
process.exit(0);
