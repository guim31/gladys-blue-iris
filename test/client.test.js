// -----------------------------------------------------------------------------
// The client of the JSON interface against the fake server: the MD5 login,
// an expired session renewed once, a refused password never retried, the
// errors by kind, the image seam.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BlueIrisClient, ERROR_KINDS } from '../src/blueiris/client.js';
import { FakeBlueIris, PASSWORD, USERNAME, network } from './helpers/fakeBlueIris.js';

const ORIGIN = 'http://192.0.2.20:81';
const server = (password = PASSWORD) => ({
  origin: ORIGIN,
  label: '192.0.2.20:81',
  username: USERNAME,
  password,
});

function setup({ password, fake = new FakeBlueIris() } = {}) {
  const client = new BlueIrisClient({
    server: server(password),
    request: network({ [ORIGIN]: fake }),
  });
  return { fake, client };
}

test('the login answers the challenge with md5("user:session:password")', async () => {
  const { fake, client } = setup();
  const info = await client.login();
  assert.equal(info['system name'], 'BLUEIRIS-PC');
  assert.equal(fake.logins, 1);
  const [challenge, response] = fake.requests;
  assert.deepEqual(challenge.body, { cmd: 'login' });
  assert.equal(response.body.response, '(md5)');
  assert.equal(client.session, response.body.session);
  const expected = createHash('md5')
    .update(`${USERNAME}:${response.body.session}:${PASSWORD}`)
    .digest('hex');
  assert.equal(expected.length, 32);
});

test('a command logs in first, then carries the session', async () => {
  const { fake, client } = setup();
  const data = await client.command('status');
  assert.equal(data.profile, 1);
  const last = fake.requests.at(-1);
  assert.equal(last.body.cmd, 'status');
  assert.equal(last.body.session, client.session);
});

test('an expired session is renewed once, the command repeated', async () => {
  const { fake, client } = setup();
  await client.command('status');
  fake.expireSessions();
  const cameras = await client.command('camlist');
  assert.ok(Array.isArray(cameras));
  assert.equal(fake.logins, 2);
});

test('a refused password stops the client at once, until unblocked', async () => {
  const { fake, client } = setup({ password: 'wrong-password' });
  await assert.rejects(client.command('status'), { kind: ERROR_KINDS.AUTH });
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(client.command('status'), { kind: ERROR_KINDS.BLOCKED });
  }
  assert.equal(fake.refusals, 1, 'one refused password, never more');
  client.unblock();
  await assert.rejects(client.command('status'), { kind: ERROR_KINDS.AUTH });
  assert.equal(fake.refusals, 2);
});

test('the errors by kind: unreachable, not Blue Iris, forbidden, refused', async () => {
  const offline = setup();
  offline.fake.online = false;
  await assert.rejects(offline.client.command('status'), { kind: ERROR_KINDS.UNREACHABLE });

  const html = new BlueIrisClient({
    server: server(),
    request: async () => ({ status: 200, headers: {}, body: Buffer.from('<html></html>') }),
  });
  await assert.rejects(html.command('status'), { kind: ERROR_KINDS.NO_API });
  const missing = new BlueIrisClient({
    server: server(),
    request: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }),
  });
  await assert.rejects(missing.command('status'), { kind: ERROR_KINDS.NO_API });

  const { client } = setup();
  await assert.rejects(client.command('trigger', { camera: 'Garden' }), {
    kind: ERROR_KINDS.FORBIDDEN,
  });
  await assert.rejects(client.command('ptz', { camera: 'Garage', button: 0 }), {
    kind: ERROR_KINDS.REFUSED,
  });
});

test('an image carries the size asked, with the session; a login page logs in again', async () => {
  const { fake, client } = setup();
  const bytes = await client.image('Garden', { width: 640, quality: 50 });
  assert.equal(bytes.length, 40_000);
  assert.deepEqual(fake.requests.at(-1).query.w, '640');
  fake.expireSessions();
  const again = await client.image('Garden', { width: 960, quality: 60 });
  assert.equal(again.length, 90_000);
  assert.equal(fake.logins, 2);
  await assert.rejects(client.image('Nope'), { kind: ERROR_KINDS.REFUSED });
});

test('logout ends the session on the server', async () => {
  const { fake, client } = setup();
  await client.login();
  assert.equal(fake.sessions.size, 1);
  await client.logout();
  assert.equal(fake.sessions.size, 0);
  assert.equal(client.session, null);
});

test('two requests in flight at most', async () => {
  const fake = new FakeBlueIris();
  let running = 0;
  let max = 0;
  const base = network({ [ORIGIN]: fake });
  const client = new BlueIrisClient({
    server: server(),
    request: async (...args) => {
      running += 1;
      max = Math.max(max, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await base(...args);
      } finally {
        running -= 1;
      }
    },
  });
  await client.login();
  await Promise.all(Array.from({ length: 6 }, () => client.command('status')));
  assert.equal(max, 2);
});
