// -----------------------------------------------------------------------------
// scripts/probe.mjs against the fake server served on 127.0.0.1: it reads,
// lists, writes nothing, and prints no secret.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { FakeBlueIris, PASSWORD } from './helpers/fakeBlueIris.js';

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/probe.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env, LOG_LEVEL: 'silent' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('the probe reads the server, writes nothing, prints no secret', async (t) => {
  const fake = new FakeBlueIris({ now: () => Date.now() });
  fake.alerts = []; // the fixture dates follow the test clock, not today
  fake.addAlert('FrontDoor', { flags: (1 << 17) | (1 << 26), memo: 'person:88%' });
  const server = await fake.serve();
  t.after(() => server.close());
  const { code, output } = await run(['127.0.0.1', 'gladys', String(server.port)], {
    BLUE_IRIS_PASSWORD: PASSWORD,
  });
  assert.equal(code, 0, output);
  assert.match(output, /System name\s+BLUEIRIS-PC/);
  assert.match(output, /Profiles\s+0=Inactive, 1=Away/);
  assert.match(output, /Camera Garden\s+Garden: online true/);
  assert.match(output, /Alerts 24 h\s+1 \{"person":1\}/);
  assert.match(output, /PTZ Garden\s+\[\{"num":1,"name":"Driveway"\}/);
  assert.match(output, /Image 960 q60\s+88 KB \(fits Gladys\)/);
  assert.match(output, /\(\+ hidden fields\)/);
  const sessions = fake.requests.map((request) => request.body?.session).filter(Boolean);
  for (const secret of [PASSWORD, '(redacted)', '192.0.2.31', ...sessions]) {
    assert.ok(!output.includes(secret), secret);
  }
  const writes = fake.requests.filter(
    (request) =>
      request.body?.profile !== undefined ||
      request.body?.signal !== undefined ||
      request.body?.button !== undefined ||
      request.body?.cmd === 'trigger',
  );
  assert.deepEqual(writes, []);
  assert.equal(fake.sessions.size, 0, 'logged out');
});

test('the probe stops at a refused password, and says how to use it', async () => {
  const fake = new FakeBlueIris();
  const server = await fake.serve();
  const refused = await run(['127.0.0.1', 'gladys', String(server.port)], {
    BLUE_IRIS_PASSWORD: 'wrong',
  });
  await server.close();
  assert.equal(refused.code, 1);
  assert.match(refused.output, /password refused/);
  assert.equal(fake.refusals, 1);
  const usage = await run([], { BLUE_IRIS_PASSWORD: '' });
  assert.equal(usage.code, 2);
});
