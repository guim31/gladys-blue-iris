// -----------------------------------------------------------------------------
// Client of the Blue Iris JSON interface (`POST /json`), the one its own web
// interface (UI3) and every Blue Iris integration use.
//
// Session: `{ cmd: "login" }` answers `result: "fail"` with a fresh `session`
// (the challenge, reason "missing response"); the second login sends
// `response = md5("user:session:password")` and answers `success` with the
// rights of the user (`admin`, `changeprofile`, `ptz`), the profile names and
// the system name. Every later command carries the session. A session that
// expired answers `fail` with the reason "Invalid session" (none before Blue
// Iris 5.8.1.1): the client logs in again once and repeats the command.
//
// A refused password is never retried: Blue Iris can ban an address after a
// few failed logins (web server option "auto-ban"). The client stops
// (`blocked`) at the first refusal and only tries again with a new
// configuration or the "Test the connection" action.
//
// Camera images: `GET /image/<short name>?w=&q=&session=` — Blue Iris scales
// and compresses them itself, so the container never decodes a JPEG.
//
// Neither the password nor the session id is ever logged: a session is as
// good as the password until it expires.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { request as httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  AUTH: 'auth',
  BLOCKED: 'blocked',
  FORBIDDEN: 'forbidden',
  NO_API: 'no_api',
  REFUSED: 'refused',
  HTTP: 'http',
});

export class BlueIrisError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'BlueIrisError';
    this.kind = kind;
  }
}

export const CLIENT_TIMINGS = {
  timeoutMs: 15_000,
  // Two requests in flight at most: the timer, a command and an image share them.
  maxInFlight: 2,
};

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

export const isJpeg = (bytes) =>
  Buffer.isBuffer(bytes) && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

const reasonOf = (answer) => {
  const data = answer?.data;
  const reason = data && typeof data === 'object' && !Array.isArray(data) ? data.reason : null;
  return typeof reason === 'string' ? reason.trim() : '';
};

const FORBIDDEN_REASON = /access|denied|permission|admin|not allowed|unauthori[sz]ed|privilege/i;

export class BlueIrisClient {
  /**
   * @param {object} options
   * @param {{ origin: string, label: string, username: string, password: string }} options.server
   * @param {Function} [options.request] HTTP seam (src/blueiris/http.js)
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   */
  constructor({ server, request = httpRequest, timings = {} }) {
    this.server = server;
    this.request = request;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.session = null;
    /** Data of the last successful login: rights, profiles, system name, version. */
    this.info = null;
    this.blocked = false;
    this.loggingIn = null;
    this.inFlight = 0;
    this.waiting = [];
  }

  get label() {
    return this.server.label;
  }

  /** Run `task` once fewer than `maxInFlight` requests are running. */
  async limit(task) {
    if (this.inFlight >= this.timings.maxInFlight) {
      await new Promise((resolve) => this.waiting.push(resolve));
    }
    this.inFlight += 1;
    try {
      return await task();
    } finally {
      this.inFlight -= 1;
      this.waiting.shift()?.();
    }
  }

  async send(path, options) {
    try {
      return await this.limit(() =>
        this.request(`${this.server.origin}${path}`, {
          timeoutMs: this.timings.timeoutMs,
          ...options,
        }),
      );
    } catch (err) {
      throw new BlueIrisError(ERROR_KINDS.UNREACHABLE, err.message);
    }
  }

  /** One POST to /json, its answer parsed. */
  async post(payload) {
    const response = await this.send('/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 404) {
      throw new BlueIrisError(ERROR_KINDS.NO_API, 'No JSON interface at this address (404)');
    }
    if (response.status === 401 || response.status === 403) {
      throw new BlueIrisError(
        ERROR_KINDS.FORBIDDEN,
        `Refused by the web server (${response.status})`,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new BlueIrisError(ERROR_KINDS.HTTP, `HTTP ${response.status}`);
    }
    let answer;
    try {
      answer = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new BlueIrisError(
        ERROR_KINDS.NO_API,
        'The answer is not JSON: not a Blue Iris server?',
      );
    }
    if (!answer || typeof answer !== 'object' || typeof answer.result !== 'string') {
      throw new BlueIrisError(ERROR_KINDS.NO_API, 'Unexpected answer: not a Blue Iris server?');
    }
    return answer;
  }

  /** Log in (challenge, then response). Concurrent callers share the login. */
  login() {
    if (this.blocked) {
      return Promise.reject(
        new BlueIrisError(ERROR_KINDS.BLOCKED, 'Stopped after a refused password'),
      );
    }
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async doLogin() {
    this.session = null;
    const challenge = await this.post({ cmd: 'login' });
    if (typeof challenge.session !== 'string' || !challenge.session) {
      throw new BlueIrisError(ERROR_KINDS.NO_API, 'No login challenge: not a Blue Iris server?');
    }
    if (challenge.result === 'success') {
      // A server or an address exempt from authentication: already logged in.
      this.session = challenge.session;
      this.info = challenge.data && typeof challenge.data === 'object' ? challenge.data : {};
      return this.info;
    }
    const { username, password } = this.server;
    const answer = await this.post({
      cmd: 'login',
      session: challenge.session,
      response: md5(`${username}:${challenge.session}:${password}`),
    });
    if (answer.result !== 'success') {
      this.blocked = true;
      const reason = reasonOf(answer);
      throw new BlueIrisError(
        ERROR_KINDS.AUTH,
        `User name or password refused${reason ? ` (${reason})` : ''}`,
      );
    }
    this.session = typeof answer.session === 'string' ? answer.session : challenge.session;
    this.info = answer.data && typeof answer.data === 'object' ? answer.data : {};
    return this.info;
  }

  async ensureSession() {
    if (!this.session) {
      await this.login();
    }
  }

  /**
   * One command of the JSON interface.
   * @returns {Promise<object|Array>} the `data` of the answer ({} when none)
   */
  async command(cmd, args = {}) {
    await this.ensureSession();
    let answer = await this.post({ ...args, cmd, session: this.session });
    if (answer.result !== 'success' && this.isInvalidSession(answer)) {
      await this.login();
      answer = await this.post({ ...args, cmd, session: this.session });
    }
    if (answer.result !== 'success') {
      const reason = reasonOf(answer);
      const kind = FORBIDDEN_REASON.test(reason) ? ERROR_KINDS.FORBIDDEN : ERROR_KINDS.REFUSED;
      throw new BlueIrisError(kind, `${cmd} refused${reason ? `: ${reason}` : ''}`);
    }
    return answer.data ?? {};
  }

  /** "Invalid session", or (before Blue Iris 5.8.1.1) a fail without reason. */
  isInvalidSession(answer) {
    const reason = reasonOf(answer);
    return reason === '' || /session/i.test(reason);
  }

  /**
   * The current image of a camera, scaled by Blue Iris.
   * @param {string} shortName the camera short name
   * @param {{ width?: number, quality?: number }} [options]
   * @returns {Promise<Buffer>} JPEG bytes
   */
  async image(shortName, { width = 1280, quality = 70 } = {}) {
    await this.ensureSession();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const query = new URLSearchParams({
        time: String(Date.now()),
        w: String(width),
        q: String(quality),
        session: this.session,
      });
      const response = await this.send(`/image/${encodeURIComponent(shortName)}?${query}`, {
        method: 'GET',
      });
      if (response.status === 200 && isJpeg(response.body)) {
        return response.body;
      }
      if (response.status === 404) {
        throw new BlueIrisError(ERROR_KINDS.REFUSED, `No camera "${shortName}" (404)`);
      }
      if (attempt === 0 && [200, 401, 403].includes(response.status)) {
        // A login page or a refusal: the session expired, log in again once.
        await this.login();
        continue;
      }
      throw new BlueIrisError(
        response.status === 403 ? ERROR_KINDS.FORBIDDEN : ERROR_KINDS.HTTP,
        response.status === 200 ? 'The answer is not a JPEG image' : `HTTP ${response.status}`,
      );
    }
    throw new BlueIrisError(ERROR_KINDS.HTTP, 'No image');
  }

  /** End the session on the server (best effort: it expires anyway). */
  async logout() {
    const session = this.session;
    this.session = null;
    if (!session) {
      return;
    }
    try {
      await this.post({ cmd: 'logout', session });
    } catch {
      // The server is gone, the session with it.
    }
  }

  /** One more try of a refused password, asked by the user. */
  unblock() {
    this.blocked = false;
  }
}
