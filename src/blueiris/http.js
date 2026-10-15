// -----------------------------------------------------------------------------
// The HTTP seam of the Blue Iris client: one request over node:http or
// node:https, answered as a whole body. The tests replace it with the fake
// server (test/helpers/fakeBlueIris.js), which speaks the same shape.
//
// node:http rather than fetch: a Blue Iris served over HTTPS has a
// self-signed certificate (or one for a public name, reached by its LAN
// address), which fetch cannot be told to accept without a dependency.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// A camera image is a few hundred kilobytes at most, an alert list a few
// hundred; anything far larger is not an answer of the JSON interface.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class HttpError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
  }
}

/**
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {number} [options.timeoutMs] idle timeout of the socket
 * @returns {Promise<{ status: number, headers: object, body: Buffer }>}
 */
export function request(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const secure = target.protocol === 'https:';
    const req = (secure ? https : http).request(target, {
      method,
      headers: {
        Connection: 'close',
        ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
      // A Blue Iris server only ever presents a self-signed certificate on the LAN.
      ...(secure ? { rejectUnauthorized: false } : {}),
    });
    let settled = false;
    const fail = (err) => {
      if (!settled) {
        settled = true;
        reject(err instanceof HttpError ? err : new HttpError(err.message, err.code));
      }
    };
    req.setTimeout(timeoutMs, () => {
      req.destroy(new HttpError(`No answer within ${Math.round(timeoutMs / 1000)} s`, 'ETIMEDOUT'));
    });
    req.on('error', fail);
    req.on('response', (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new HttpError('Answer too large', 'EFBIG'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('end', () => {
        if (!settled) {
          settled = true;
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        }
      });
    });
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}
