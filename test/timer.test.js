// -----------------------------------------------------------------------------
// The timers of the container. Gladys never polls a device published with
// should_poll: false (and never polls the devices created without
// should_poll, GladysAssistant/Gladys#3198): the server must be read again by
// the hub's own timer, with no onPoll at all, at the refresh interval of the
// configuration; the camera images at the image interval; an unchanged value
// sent again every 6 hours.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  BASE_CONFIG,
  FLAGS,
  cameraIds,
  createAll,
  createWorld,
  serverIds,
  settle,
} from './helpers/world.js';

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_792_087_200_000 });
  // The hub reads the mocked clock, which the ticks move.
  const clock = { now: () => Date.now(), advance: () => {} };
  const w = await createWorld({ timers: true, clock, ...options });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const reads = (w, cmd) => w.server.requests.filter((r) => r.body?.cmd === cmd).length;

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle();
}

test('the internal timer reads Blue Iris again without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  const motion = cameraIds(w.gladys, 'Garden').feature('motion');
  const before = reads(w, 'camlist');

  w.server.camera('Garden').isMotion = true;
  await tick(t, 10_000);
  assert.equal(w.fake.lastState(motion), 1);
  w.server.camera('Garden').isMotion = false;
  await tick(t, 10_000);
  assert.equal(w.fake.lastState(motion), 0);
  // The test never calls fake.poll(): every read came from the timer.
  assert.equal(reads(w, 'camlist') - before, 2, 'one read per interval');
});

test('the refresh interval follows the configuration', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, refresh_interval: '60' } });
  const before = reads(w, 'status');
  await tick(t, 30_000);
  assert.equal(reads(w, 'status'), before);
  await tick(t, 30_000);
  assert.equal(reads(w, 'status'), before + 1);
});

test('an alert seen by the timer fires its scene event', async (t) => {
  const w = await timedWorld(t);
  w.server.addAlert('Garden', { flags: FLAGS.MOTION, at: Date.now() + 1 });
  await tick(t, 10_000);
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('onPoll from Gladys reads only when the timer is late', async (t) => {
  const w = await timedWorld(t);
  const device = w.fake.discoveredDevices[0];
  const before = reads(w, 'status');
  await w.fake.poll(device);
  assert.equal(reads(w, 'status'), before, 'just read by the start');
  await tick(t, 9_000);
  await w.fake.poll(device);
  assert.equal(reads(w, 'status'), before + 1, 'the timer ran at 10 s');
});

test('camera images follow the interval of the configuration', async (t) => {
  const w = await timedWorld(t);
  const images = w.fake.cameraImages.length;
  await tick(t, 5 * 60_000);
  // Front door and Garden; Garage is offline.
  assert.equal(w.fake.cameraImages.length - images, 2);
});

test('no periodic image when the configuration says "only on alerts"', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, snapshot_interval: '0' } });
  const images = w.fake.cameraImages.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.fake.cameraImages.length, images);
});

test('the timers stop with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const requests = w.server.requests.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.server.requests.length, requests);
});

test('an unchanged value is sent again every 6 hours (heartbeat, under the 12 h rule)', async (t) => {
  const w = await timedWorld(t, {
    config: { ...BASE_CONFIG, snapshot_interval: '0', refresh_interval: '60' },
  });
  const feature = serverIds(w.gladys).feature('disk_free');
  const sent = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === feature).length;
  const before = sent();
  const step = 60_000;
  for (let elapsed = 0; elapsed < HUB_TIMINGS.heartbeatMs - step; elapsed += step) {
    await tick(t, step);
  }
  assert.equal(sent(), before, 'nothing sent while the value is recent');
  await tick(t, 2 * step);
  assert.equal(sent(), before + 1, 'sent again once 6 hours old');
  assert.ok(HUB_TIMINGS.heartbeatMs <= 12 * 60 * 60_000);
});
