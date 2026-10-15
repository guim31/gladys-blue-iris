// -----------------------------------------------------------------------------
// The hub end to end, against the fake Gladys and the fake Blue Iris: what is
// discovered, the states, the alerts and their scene event, the commands and
// their safety (no disarming unless allowed), the PTZ watchdog, images,
// persistence under /data, the server lost and back.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_CAMERA_IMAGE } from '../src/image.js';
import {
  BASE_CONFIG,
  FLAGS,
  FakeBlueIris,
  cameraIds,
  createAll,
  createClock,
  createWorld,
  discovered,
  serverIds,
  settle,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('discovers the server and the cameras, groups and system entries left out', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['BLUEIRIS-PC', 'Front door', 'Garden', 'Garage'],
  );
  assert.ok(devices.every((device) => device.should_poll === false));
  const server = discovered(w, serverIds(w.gladys).device);
  assert.equal(server.model, 'Blue Iris 5.9.9.33');
  const profile = server.features.find((f) => f.external_id.endsWith(':profile'));
  assert.equal(profile.read_only, false, 'the user may change profiles');
  assert.deepEqual(
    profile.supported_options.map((option) => option.label),
    ['Inactive', 'Away', 'Home', 'Night', 'Vacation', 'Profile 5', 'Profile 6', 'Profile 7'],
  );
  const garden = discovered(w, cameraIds(w.gladys, 'Garden').device);
  const preset = garden.features.find((f) => f.type === 'preset');
  assert.deepEqual(
    preset.supported_options.map((option) => [option.value, option.label]),
    [
      [1, 'Driveway'],
      [2, 'Gate'],
    ],
  );
  assert.equal(preset.max, 2);
  const move = garden.features.find((f) => f.type === 'move');
  assert.deepEqual(
    move.supported_options.map((option) => option.value),
    [1, 2, 3, 4, 5, 6],
  );
  // Front door had an AI person alert in the last 24 hours: it has the feature.
  const front = discovered(w, cameraIds(w.gladys, 'FrontDoor').device);
  assert.ok(front.features.some((f) => f.external_id.endsWith(':person')));
  assert.ok(!front.features.some((f) => f.type === 'move'));
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('states of the server and the cameras, once added', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0, 'nothing before the devices are added');
  await createAll(w);
  const server = serverIds(w.gladys);
  assert.equal(w.fake.lastState(server.feature('online')), 1);
  assert.equal(w.fake.lastState(server.feature('profile')), '1');
  assert.equal(w.fake.lastState(server.feature('signal')), 'green');
  assert.equal(w.fake.lastState(server.feature('cpu')), 9);
  assert.equal(w.fake.lastState(server.feature('disk_used')), 84.9);
  assert.equal(w.fake.lastState(server.feature('disk_free')), 335.4);
  const garage = cameraIds(w.gladys, 'Garage');
  assert.equal(w.fake.lastState(garage.feature('online')), 0);
  const front = cameraIds(w.gladys, 'FrontDoor');
  assert.equal(w.fake.lastState(front.feature('online')), 1);
  assert.equal(w.fake.lastState(front.feature('person')), 0);
  // One image per online camera added, under 150 KB, after a smaller request.
  assert.equal(w.fake.cameraImages.length, 2);
  for (const { image } of w.fake.cameraImages) {
    assert.ok(image.startsWith('image/jpg;base64,'));
    assert.ok(image.length <= MAX_CAMERA_IMAGE);
  }
  const widths = w.server.requests.filter((r) => r.path === '/image/Garden').map((r) => r.query.w);
  assert.deepEqual(widths, ['1280', '960']);
  const transports = new Map(
    w.fake.transports.map((entry) => [entry.device_external_id, entry.transport]),
  );
  assert.equal(transports.get(garage.device), 'unreachable');
  assert.equal(transports.get(front.device), 'local');
});

test('motion and trigger follow the camera list', async (t) => {
  const w = await world(t);
  await createAll(w);
  const garden = cameraIds(w.gladys, 'Garden');
  Object.assign(w.server.camera('Garden'), { isMotion: true, isTriggered: true });
  await w.hub.refresh();
  assert.equal(w.fake.lastState(garden.feature('motion')), 1);
  assert.equal(w.fake.lastState(garden.feature('triggered')), 1);
  w.server.untrigger('Garden');
  await w.hub.refresh();
  assert.equal(w.fake.lastState(garden.feature('motion')), 0);
  assert.equal(w.fake.lastState(garden.feature('triggered')), 0);
});

test('a new alert fires camera_alert with what was seen, after a fresh image', async (t) => {
  const w = await world(t);
  await createAll(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'the past alerts fire nothing');
  const images = w.fake.cameraImages.length;
  w.clock.advance(60_000);
  await w.alert('FrontDoor', {
    flags: FLAGS.MOTION | FLAGS.AI_PERSON | FLAGS.AI_CONFIRMED,
    memo: 'person:93%',
  });
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'camera_alert',
      data: {
        camera: cameraIds(w.gladys, 'FrontDoor').device,
        detection: 'person',
        camera_name: 'Front door',
        detection_name: 'Person',
        memo: 'person:93%',
      },
    },
  ]);
  assert.equal(w.fake.cameraImages.length, images + 1, 'the image comes before the event');
  const person = cameraIds(w.gladys, 'FrontDoor').feature('person');
  assert.equal(w.fake.lastState(person), 1);
  // Still triggered: still on. Calm and 30 s later: off.
  w.clock.advance(40_000);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(person), 1);
  w.server.untrigger('FrontDoor');
  await w.hub.refresh();
  assert.equal(w.fake.lastState(person), 0);
  assert.ok(w.fake.widgetRefreshes.includes('blue_iris'));
});

test('a vehicle on a camera without AI feature yet: the feature is learned and kept', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = discovered(w, cameraIds(w.gladys, 'Garden').device);
  assert.ok(!before.features.some((f) => f.external_id.endsWith(':vehicle')));
  await w.alert('Garden', { flags: FLAGS.MOTION | FLAGS.AI_VEHICLE, memo: 'car:77%' });
  const after = discovered(w, cameraIds(w.gladys, 'Garden').device);
  assert.ok(after.features.some((f) => f.external_id.endsWith(':vehicle')));
  assert.equal(w.fake.sceneEvents.at(-1).data.detection, 'vehicle');
  await w.hub.store.flush();
  const saved = JSON.parse(await readFile(join(w.dataDir, 'blue-iris-state.json'), 'utf8'));
  assert.deepEqual(saved.cameras.find((c) => c.short === 'Garden').learned, ['vehicle']);
});

test('several alerts in one read: each fires once, a cancelled one never', async (t) => {
  const w = await world(t);
  w.server.addAlert('Garden', { flags: FLAGS.MOTION, at: w.clock.now() + 100 });
  w.server.addAlert('Garden', { flags: FLAGS.MOTION | FLAGS.CANCELLED, at: w.clock.now() + 200 });
  w.server.addAlert('Garden', { flags: FLAGS.AUDIO, at: w.clock.now() + 300 });
  w.clock.advance(1000);
  await w.hub.refresh();
  await w.hub.refresh();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.data.detection),
    ['motion', 'audio'],
  );
});

test('a camera added to Blue Iris later: its past fires nothing, its next alert does', async (t) => {
  const w = await world(t);
  w.server.cameras.push({
    ...structuredClone(w.server.camera('Garage')),
    optionValue: 'Porch',
    optionDisplay: 'Porch',
    isOnline: true,
    isNoSignal: false,
    alertutc: 1792080000,
  });
  w.server.alerts.push({ camera: 'Porch', date: 1792080000, flags: FLAGS.MOTION, memo: '' });
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 0);
  await w.alert('Porch', { flags: FLAGS.MOTION });
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.equal(w.fake.sceneEvents[0].data.camera_name, 'Porch');
});

test('without the right to read alerts, the alert time alone fires an "other" alert', async (t) => {
  const server = new FakeBlueIris();
  server.alertlistAllowed = 'Access denied';
  const w = await world(t, { server });
  await w.alert('Garden', { flags: FLAGS.MOTION | FLAGS.AI_PERSON });
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.equal(w.fake.sceneEvents[0].data.detection, 'other');
});

test('arming is allowed; disarming is refused by default, as a profile or a signal', async (t) => {
  const w = await world(t);
  await createAll(w);
  const server = discovered(w, serverIds(w.gladys).device);
  const feature = (key) => server.features.find((f) => f.external_id.endsWith(`:${key}`));

  // Profile 2 is "Home", listed as disarmed in the configuration; 0 is Inactive.
  for (const value of ['0', '2']) {
    const ack = await w.fake.setValue(server, feature('profile'), value);
    assert.equal(ack.success, false, value);
    assert.match(ack.error, /Disarming from Gladys is off/);
  }
  const red = await w.fake.setValue(server, feature('signal'), 'red');
  assert.equal(red.success, false);
  const yellow = await w.fake.setValue(server, feature('signal'), 'yellow');
  assert.match(yellow.error, /Yellow is a transition/);
  assert.ok(
    !w.server.requests.some((r) => r.body?.profile !== undefined || r.body?.signal !== undefined),
    'nothing was sent to Blue Iris',
  );

  const night = await w.fake.setValue(server, feature('profile'), '3');
  assert.equal(night.success, true, night.error);
  assert.equal(w.fake.lastState(serverIds(w.gladys).feature('profile')), '3');
  // Sent twice: held, the schedule of Blue Iris does not switch it back.
  const sent = w.server.requests.filter((r) => r.body?.profile === 3);
  assert.equal(sent.length, 2);
  assert.equal(w.server.status.lock, '1');

  w.server.status.signal = '0';
  const green = await w.fake.setValue(server, feature('signal'), 'green');
  assert.equal(green.success, true, green.error);
  assert.equal(w.server.status.signal, '1');
  assert.equal(w.fake.lastState(serverIds(w.gladys).feature('signal')), 'green');
});

test('disarming once allowed; a profile held once only when asked', async (t) => {
  const w = await world(t, {
    config: { ...BASE_CONFIG, allow_disarm: true, hold_profile: false },
  });
  await createAll(w);
  const server = discovered(w, serverIds(w.gladys).device);
  const feature = (key) => server.features.find((f) => f.external_id.endsWith(`:${key}`));
  assert.equal((await w.fake.setValue(server, feature('signal'), 'red')).success, true);
  assert.equal(w.server.status.signal, '0');
  assert.equal((await w.fake.setValue(server, feature('profile'), '0')).success, true);
  assert.equal(w.server.requests.filter((r) => r.body?.profile === 0).length, 1);
  assert.equal(w.server.status.lock, '2', 'temporary: the schedule takes over later');
});

test('a user without the profile right: read-only selects, a clear refusal', async (t) => {
  const server = new FakeBlueIris({ rights: { changeprofile: false } });
  const w = await world(t, { server });
  await createAll(w);
  const device = discovered(w, serverIds(w.gladys).device);
  const profile = device.features.find((f) => f.external_id.endsWith(':profile'));
  assert.equal(profile.read_only, true);
  const ack = await w.fake.setValue(device, profile, '1');
  assert.match(ack.error, /may not change the profile/);
});

test('scene actions: profile by name, signal, trigger, image', async (t) => {
  const server = new FakeBlueIris({ rights: { admin: true } });
  const w = await world(t, { server });
  await createAll(w);
  assert.equal((await w.fake.sceneAction('set_profile', { profile: 'night' })).success, true);
  assert.equal(server.status.profile, 3);
  const unknown = await w.fake.sceneAction('set_profile', { profile: 'Holidays' });
  assert.match(unknown.error, /Unknown profile/);
  const home = await w.fake.sceneAction('set_profile', { profile: 'Home' });
  assert.match(home.error, /Disarming from Gladys is off/);
  assert.equal((await w.fake.sceneAction('set_signal', { signal: 'green' })).success, true);
  assert.equal((await w.fake.sceneAction('set_signal', { signal: 'red' })).success, false);
  const garden = cameraIds(w.gladys, 'Garden').device;
  assert.equal((await w.fake.sceneAction('trigger_camera', { camera: garden })).success, true);
  assert.deepEqual(server.triggers, ['Garden']);
  const images = w.fake.cameraImages.length;
  assert.equal((await w.fake.sceneAction('refresh_snapshot', { camera: garden })).success, true);
  assert.equal(w.fake.cameraImages.length, images + 1);
  assert.equal(w.fake.sceneEvents.length, 0, 'no action fires an event');
  const missing = await w.fake.sceneAction('trigger_camera', { camera: 'ext:nope' });
  assert.match(missing.error, /not \(or no longer\)/);
});

test('a trigger refused for a plain user says which right is missing', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('trigger_camera', {
    camera: cameraIds(w.gladys, 'Garden').device,
  });
  assert.match(ack.error, /not allowed to do this/);
});

test('PTZ: a move starts, stops on 0, and stops by itself without it', async (t) => {
  const w = await world(t);
  await createAll(w);
  const garden = discovered(w, cameraIds(w.gladys, 'Garden').device);
  const move = garden.features.find((f) => f.type === 'move');
  const preset = garden.features.find((f) => f.type === 'preset');
  assert.equal((await w.fake.setValue(garden, move, 1)).success, true);
  assert.equal((await w.fake.setValue(garden, move, 0)).success, true);
  assert.deepEqual(w.server.ptz, [
    { camera: 'Garden', button: 0, updown: 1 },
    { camera: 'Garden', button: 0, updown: 0 },
  ]);
  w.server.ptz.length = 0;
  // A lone value (a scene, a lost release): the watchdog stops it.
  assert.equal((await w.fake.setValue(garden, move, 5)).success, true);
  await sleep(120);
  assert.deepEqual(w.server.ptz, [
    { camera: 'Garden', button: 5, updown: 1 },
    { camera: 'Garden', button: 5, updown: 0 },
  ]);
  w.server.ptz.length = 0;
  // A new direction stops the previous one first.
  await w.fake.setValue(garden, move, 3);
  await w.fake.setValue(garden, move, 2);
  assert.deepEqual(
    w.server.ptz.map((entry) => [entry.button, entry.updown]),
    [
      [2, 1],
      [2, 0],
      [1, 1],
    ],
  );
  await sleep(120);
  w.server.ptz.length = 0;
  assert.equal((await w.fake.setValue(garden, preset, 2)).success, true);
  assert.deepEqual(w.server.ptz, [{ camera: 'Garden', button: 102, updown: undefined }]);
  assert.equal((await w.fake.setValue(garden, preset, 9)).success, false);
});

test('the integration stops the PTZ moves when it stops', async (t) => {
  const w = await createWorld({ timings: { ptzWatchdogMs: 60_000 } });
  await createAll(w);
  const garden = discovered(w, cameraIds(w.gladys, 'Garden').device);
  await w.fake.setValue(
    garden,
    garden.features.find((f) => f.type === 'move'),
    4,
  );
  await w.app.stop();
  assert.deepEqual(w.server.ptz.at(-1), { camera: 'Garden', button: 3, updown: 0 });
  t.after(() => {});
});

test('the server lost: everything offline, then back', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.server.online = false;
  await w.hub.refresh();
  const front = cameraIds(w.gladys, 'FrontDoor');
  assert.equal(w.fake.lastState(serverIds(w.gladys).feature('online')), 0);
  assert.equal(w.fake.lastState(front.feature('online')), 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.equal(w.fake.discoveredDevices.length, 4, 'the devices stay discoverable');
  w.server.online = true;
  await w.hub.refresh();
  assert.equal(w.fake.lastState(front.feature('online')), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a server off at start keeps its devices from /data', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const server = new FakeBlueIris();
  server.online = false;
  const w = await world(t, { server, dataDir: first.dataDir });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['BLUEIRIS-PC', 'Front door', 'Garden', 'Garage'],
  );
  assert.equal(w.fake.connectionStatus.connected, false);
});

test('a refused password stops at once, and the test action tries once more', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong-password-value' } });
  for (let i = 0; i < 4; i += 1) {
    await w.hub.refresh();
  }
  assert.equal(w.server.refusals, 1);
  assert.match(w.fake.connectionStatus.message.en, /ban Gladys/);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /User name or password refused/);
  assert.equal(w.server.refusals, 2);
  // The right password: everything starts.
  await w.fake.configUpdated(BASE_CONFIG);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a new configuration of the server starts a new session; the old one is closed', async (t) => {
  const w = await world(t);
  const sessions = w.server.sessions.size;
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'fr' });
  assert.equal(w.server.sessions.size, sessions, 'same server, same session');
  const device = discovered(w, cameraIds(w.gladys, 'FrontDoor').device);
  assert.ok(
    device.features.some((f) => f.name === 'Mouvement'),
    'renamed in French',
  );
  await w.fake.configUpdated({ ...BASE_CONFIG, username: 'other' });
  assert.equal(w.server.sessions.size, 0, 'the old session was closed');
  await w.fake.configUpdated({});
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
});

test('onGetImage answers a fresh image; an unknown camera is refused', async (t) => {
  const w = await world(t);
  const device = discovered(w, cameraIds(w.gladys, 'Garden').device);
  const ack = await w.fake.getImage(device);
  assert.equal(ack.success, true);
  assert.ok(ack.data.image.startsWith('image/jpg;base64,'));
  const unknown = await w.fake.getImage({ external_id: 'ext:test-integration:camera:nope' });
  assert.equal(unknown.success, false);
});

test('Gladys reconnecting gets every state again', async (t) => {
  const w = await world(t, { clock: createClock() });
  await createAll(w);
  const count = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(w.fake.states.length > count);
});

test('an alert list refused at start only: the next alerts are read in full', async (t) => {
  const server = new FakeBlueIris();
  server.alertlistAllowed = 'Busy';
  const w = await world(t, { server });
  server.alertlistAllowed = true;
  await w.alert('Garden', { flags: FLAGS.MOTION | FLAGS.AI_PERSON, memo: 'person:70%' });
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.equal(w.fake.sceneEvents[0].data.detection, 'person');
});
