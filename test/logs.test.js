// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle — reads, motion, alerts, images, scene events, widget —
// writes nothing; a failure that repeats is logged once, and its end once.
// Never the password of the configuration, nor a session id.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  FLAGS,
  FakeBlueIris,
  PASSWORD,
  cameraIds,
  createAll,
  createWorld,
  discovered,
  settle,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** Every session the fake server handed out: as secret as the password. */
const sessions = (w) =>
  w.server.requests.map((request) => request.body?.session).filter((value) => value);

function assertNoSecret(text, w, extra = []) {
  for (const secret of [PASSWORD, ...extra, ...sessions(w)]) {
    assert.ok(!text.includes(secret), `a secret is in the logs: ${secret.slice(0, 4)}…`);
  }
}

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to Blue Iris 5.9.9.33 at 192.0.2.20:81')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 3; i += 1) {
    w.server.camera('Garden').isMotion = true;
    await w.alert('Garden', { flags: FLAGS.MOTION, memo: '' });
    await w.alert('FrontDoor', { flags: FLAGS.MOTION | FLAGS.AI_PERSON, memo: 'person:90%' });
    w.server.untrigger('Garden');
    w.server.untrigger('FrontDoor');
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
    await w.hub.snapshotAll();
    await w.fake.widgetGet('blue_iris', { settings: {}, language: 'en' });
  }
  w.server.expireSessions(); // a session renewed is routine too
  await w.hub.refresh();
  await settle();
  assert.deepEqual(logs.texts(), []);
  assert.ok(w.fake.sceneEvents.length >= 6);
  assertNoSecret(logs.texts().join('\n'), w);
});

test('the server down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  const lines = logs.texts();
  assert.equal(
    lines.filter((text) => text.includes('Cannot read Blue Iris at 192.0.2.20:81')).length,
    1,
    lines.join('\n'),
  );
  assert.equal(lines.filter((text) => text.includes('is offline')).length, 1, lines.join('\n'));
  assert.equal(lines.length, 2, lines.join('\n'));

  logs.clear();
  w.server.online = true;
  await w.hub.refresh();
  await w.hub.refresh();
  const back = logs.texts();
  assert.equal(back.filter((text) => /answers again after 5 min/.test(text)).length, 1);
  assert.equal(back.filter((text) => text.includes('online again')).length, 1, back.join('\n'));
  assert.equal(back.length, 2, back.join('\n'));
});

test('a camera lost and back: one line each', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.camera('Garden').isOnline = false;
  await w.hub.refresh();
  await w.hub.refresh();
  w.server.camera('Garden').isOnline = true;
  await w.hub.refresh();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Camera Garden is offline', 'Camera Garden is online again'],
  );
});

test('a refused password is logged once, its repeats only at debug; never a password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong-secret-value' } });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.refresh();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(
    warnings[0].text,
    /Cannot read Blue Iris at 192\.0\.2\.20:81: User name or password refused/,
  );
  assertNoSecret(logs.texts().join('\n'), w, ['wrong-secret-value']);
});

test('a camera that stops sending images is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.server.imageStatus = 500;
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(10 * 60_000);
    await w.hub.snapshotAll();
  }
  const failing = logs.texts();
  // Front door and Garden.
  assert.equal(failing.length, 2, failing.join('\n'));
  assert.ok(failing.every((text) => text.includes('No image from')));
  logs.clear();
  w.server.imageStatus = 200;
  w.clock.advance(10 * 60_000);
  await w.hub.snapshotAll();
  assert.equal(logs.texts().length, 2, logs.texts().join('\n'));
  assert.ok(logs.texts().every((text) => text.includes('back')));
});

test('a user command is one line', async (t) => {
  const logs = captureLogs(t);
  const server = new FakeBlueIris({ rights: { admin: true } });
  const w = await world(t, { server });
  await createAll(w);
  logs.clear();
  const device = discovered(w, w.gladys.externalIds('server', 'server').device);
  await w.fake.setValue(
    device,
    device.features.find((f) => f.external_id.endsWith(':profile')),
    '3',
  );
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Profile set to 3 \(Night\)/);
  logs.clear();
  await w.fake.sceneAction('trigger_camera', { camera: cameraIds(w.gladys, 'Garden').device });
  assert.equal(logs.texts().length, 1);
  logs.clear();
  await w.fake.sceneAction('set_signal', { signal: 'red' });
  assert.equal(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Signal red refused/);
  logs.clear();
  await w.fake.action('test_connection', {});
  assert.equal(logs.texts().length, 1, logs.texts().join('\n'));
});

test('LOG_LEVEL=debug shows the alerts; never a password nor a session', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await w.alert('FrontDoor', { flags: FLAGS.MOTION | FLAGS.AI_PERSON, memo: 'person:90%' });
  w.server.online = false;
  await w.hub.refresh();
  await w.hub.refresh();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*Alert on Front door: person, motion \(person:90%\)/);
  assert.match(text, /\[DEBUG\].*Cannot read Blue Iris/);
  assertNoSecret(text, w);
});
