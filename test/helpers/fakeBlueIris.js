// -----------------------------------------------------------------------------
// A fake Blue Iris server, built from test/fixtures/blueiris: the JSON
// interface (challenge/response login with the MD5 of "user:session:password",
// sessions that expire, status with profile/signal/lock, camlist, alertlist,
// ptz, trigger, logout) and the camera images (`/image/<short>?w=&q=`), whose
// size follows the requested width like a real server.
//
// Two ways to reach it: `network(fake)` returns the HTTP seam of the client
// (no socket at all), `fake.serve()` listens on 127.0.0.1 for the probe test.
// Every request is recorded in `requests` (`{ method, path, body }`); a
// password is never stored there, only whether the login succeeded.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';

export const USERNAME = 'gladys';
export const PASSWORD = 'Bi-Secret-Pass-42';
export const NOW_S = 1792087200; // 2026-10-15T18:00:00Z, the clock of the fixtures

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/blueiris/${name}.json`, import.meta.url), 'utf8'));

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

export const FLAGS = {
  MOTION: 1 << 17,
  AUDIO: 1 << 19,
  EXTERNAL: 1 << 20,
  CANCELLED: 1 << 23,
  AI_PERSON: 1 << 26,
  AI_VEHICLE: 1 << 27,
  AI_CONFIRMED: 1 << 28,
};

/** JPEG-looking bytes of a given size: SOI, a baseline frame header, filler, EOI. */
export function jpeg(size, width = 1280, height = 720) {
  const bytes = Buffer.alloc(size, 0x55);
  const header = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08];
  header.push(height >> 8, height & 0xff, width >> 8, width & 0xff);
  header.push(0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  Buffer.from(header).copy(bytes);
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

export class FakeBlueIris {
  /**
   * @param {object} [options]
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {object} [options.rights] overrides of the login data (admin, changeprofile, ptz)
   * @param {() => number} [options.now] clock in ms (alert dates)
   */
  constructor({ username = USERNAME, password = PASSWORD, rights = {}, now } = {}) {
    this.username = username;
    this.password = password;
    this.loginData = { ...fixture('login'), ...rights };
    this.status = fixture('status');
    this.cameras = fixture('camlist');
    this.alerts = fixture('alertlist');
    this.ptzInfo = fixture('ptz');
    this.now = now ?? (() => NOW_S * 1000);
    this.online = true;
    this.sessions = new Set();
    this.challenges = new Set();
    this.counter = 0;
    this.requests = [];
    this.logins = 0;
    this.refusals = 0;
    this.ptz = [];
    this.triggers = [];
    // Bytes of an image by requested width: a 1280 px view is too large for Gladys.
    this.imageSize = (width) => (width >= 1280 ? 140_000 : width >= 960 ? 90_000 : 40_000);
    this.imageStatus = 200;
    // Answer of the alert list: true, or a reason string to refuse it.
    this.alertlistAllowed = true;
  }

  camera(short) {
    return this.cameras.find((entry) => entry.optionValue === short);
  }

  /** A new alert on a camera: its record, and the camera list says so. */
  addAlert(short, { flags = FLAGS.MOTION | FLAGS.AI_CONFIRMED, memo = '', at } = {}) {
    const date = Math.floor((at ?? this.now()) / 1000);
    this.counter += 1;
    const record = {
      camera: short,
      path: `@8400${String(this.counter).padStart(4, '0')}.bvr`,
      offset: 1000,
      flags,
      res: '2688x1520',
      zones: 1,
      date,
      color: 8151097,
      filesize: '7 sec',
      clip: `@8399${String(this.counter).padStart(4, '0')}.bvr`,
      memo,
    };
    this.alerts.push(record);
    const camera = this.camera(short);
    camera.alertutc = date;
    camera.newalerts = (camera.newalerts ?? 0) + 1;
    camera.isTriggered = true;
    camera.isAlerting = true;
    return record;
  }

  /** The camera calms down. */
  untrigger(short) {
    Object.assign(this.camera(short), { isTriggered: false, isAlerting: false, isMotion: false });
  }

  expireSessions() {
    this.sessions.clear();
  }

  newSession() {
    this.counter += 1;
    return md5(`session-${this.counter}`);
  }

  answer(body) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify(body)),
    };
  }

  /** One HTTP request: { method, path (with query), body (string) }. */
  handle({ method, path, body }) {
    const url = new URL(path, 'http://fake');
    if (url.pathname === '/json' && method === 'POST') {
      let payload;
      try {
        payload = JSON.parse(body ?? '');
      } catch {
        return this.answer({ result: 'fail', data: { reason: 'bad json' } });
      }
      const recorded = { ...payload };
      if (recorded.response) {
        recorded.response = '(md5)';
      }
      this.requests.push({ method, path: url.pathname, body: recorded });
      return this.answer(this.json(payload));
    }
    const image = url.pathname.match(/^\/image\/([^/]+)$/);
    if (image && method === 'GET') {
      this.requests.push({
        method,
        path: url.pathname,
        query: Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'session')),
      });
      if (!this.sessions.has(url.searchParams.get('session'))) {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('<html>login</html>'),
        };
      }
      const short = decodeURIComponent(image[1]);
      if (!this.camera(short)) {
        return { status: 404, headers: {}, body: Buffer.alloc(0) };
      }
      if (this.imageStatus !== 200) {
        return { status: this.imageStatus, headers: {}, body: Buffer.alloc(0) };
      }
      const width = Number(url.searchParams.get('w')) || 1920;
      return {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        body: jpeg(this.imageSize(width), width, Math.round((width * 9) / 16)),
      };
    }
    this.requests.push({ method, path: url.pathname });
    return { status: 404, headers: {}, body: Buffer.from('Not found') };
  }

  json(payload) {
    const { cmd } = payload;
    if (cmd === 'login') {
      return this.login(payload);
    }
    if (!this.sessions.has(payload.session)) {
      return { result: 'fail', data: { reason: 'Invalid session' } };
    }
    const data = this.loginData;
    const admin = Boolean(data.admin);
    const canChange = data.changeprofile ?? admin;
    switch (cmd) {
      case 'logout':
        this.sessions.delete(payload.session);
        return { result: 'success' };
      case 'status': {
        if (payload.profile !== undefined || payload.signal !== undefined) {
          if (!canChange) {
            return { result: 'fail', data: { reason: 'Access denied' } };
          }
        }
        if (payload.profile !== undefined) {
          const profile = Number(payload.profile);
          // Once: temporary (lock 2); the same profile again: held (lock 1).
          const same = this.status.profile === profile && String(this.status.lock) !== '0';
          this.status.profile = profile;
          this.status.lock = same ? '1' : '2';
        }
        if (payload.signal !== undefined) {
          this.status.signal = String(payload.signal);
        }
        return { result: 'success', data: { ...this.status } };
      }
      case 'camlist':
        return { result: 'success', data: structuredClone(this.cameras) };
      case 'alertlist': {
        if (this.alertlistAllowed !== true) {
          return { result: 'fail', data: { reason: this.alertlistAllowed } };
        }
        const start = Number(payload.startdate ?? 0);
        const end = Number(payload.enddate ?? Number.MAX_SAFE_INTEGER);
        const all = !payload.camera || payload.camera === 'index';
        return {
          result: 'success',
          data: this.alerts
            .filter(
              (alert) =>
                (all || alert.camera === payload.camera) &&
                alert.date >= start &&
                alert.date <= end,
            )
            .filter((alert) => payload.view !== 'alerts' || !(alert.flags & FLAGS.CANCELLED))
            .map((alert) => ({ ...alert })),
        };
      }
      case 'ptz': {
        if (!data.ptz) {
          return { result: 'fail', data: { reason: 'Access denied' } };
        }
        const camera = this.camera(payload.camera);
        if (!camera?.ptz) {
          return { result: 'fail', data: { reason: 'Not a PTZ camera' } };
        }
        if (payload.button === undefined) {
          return { result: 'success', data: structuredClone(this.ptzInfo) };
        }
        this.ptz.push({ camera: payload.camera, button: payload.button, updown: payload.updown });
        return { result: 'success' };
      }
      case 'trigger': {
        if (!admin) {
          return { result: 'fail', data: { reason: 'Access denied' } };
        }
        const camera = this.camera(payload.camera);
        if (!camera) {
          return { result: 'fail', data: { reason: 'No such camera' } };
        }
        camera.isTriggered = true;
        this.triggers.push(payload.camera);
        return { result: 'success' };
      }
      default:
        return { result: 'fail', data: { reason: `unknown command ${cmd}` } };
    }
  }

  login(payload) {
    if (!payload.session || !payload.response) {
      const session = this.newSession();
      this.challenges.add(session);
      return { result: 'fail', session, data: { reason: 'missing response' } };
    }
    if (!this.challenges.has(payload.session)) {
      return { result: 'fail', data: { reason: 'Invalid session' } };
    }
    this.challenges.delete(payload.session);
    const expected = md5(`${this.username}:${payload.session}:${this.password}`);
    if (payload.response !== expected) {
      this.refusals += 1;
      return { result: 'fail', data: { reason: 'Invalid login' } };
    }
    this.logins += 1;
    this.sessions.add(payload.session);
    return { result: 'success', session: payload.session, data: { ...this.loginData } };
  }

  /** Listen on 127.0.0.1 (the probe test). */
  async serve() {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const answer = this.handle({
          method: req.method,
          path: req.url,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(answer.status, answer.headers);
        res.end(answer.body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }
}

/**
 * The HTTP seam of the client, answered by fake servers by origin.
 * @param {Record<string, FakeBlueIris>} servers
 */
export function network(servers) {
  return async (url, { method = 'GET', body } = {}) => {
    const target = new URL(url);
    const fake = servers[target.origin];
    await new Promise((resolve) => setImmediate(resolve));
    if (!fake || !fake.online) {
      const err = new Error(`connect EHOSTUNREACH ${target.host}`);
      err.code = 'EHOSTUNREACH';
      throw err;
    }
    return fake.handle({ method, path: `${target.pathname}${target.search}`, body });
  };
}
