import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALERT_FLAGS,
  DETECTIONS,
  memoLabels,
  parseAlert,
  parseAlerts,
  parseCameras,
  parsePresets,
  parseRights,
  parseServerInfo,
  parseSize,
  parseStatus,
} from '../src/blueiris/model.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/blueiris/${name}.json`, import.meta.url), 'utf8'));

test('status: signal, profile, CPU, disks in MiB', () => {
  const status = parseStatus(fixture('status'));
  assert.deepEqual(status, {
    signal: 'green',
    profile: 1,
    lock: 0,
    cpu: 9,
    diskUsedPercent: 84.9,
    diskFreeGb: 335.4,
    schedule: 'Default',
  });
  assert.equal(parseStatus({ signal: '0' }).signal, 'red');
  assert.equal(parseStatus({ signal: 2 }).signal, 'yellow');
  assert.equal(parseStatus({ signal: '7', profile: 9 }).signal, null);
  assert.equal(parseStatus({ profile: 9 }).profile, null);
  assert.equal(parseStatus(null).cpu, null);
});

test('status of an older server: the clips text', () => {
  const status = parseStatus({ clips: 'Clips: 99 items, 1.5T/2.0T; D: +500.0G' });
  assert.equal(status.diskUsedPercent, 75);
  assert.equal(status.diskFreeGb, 512);
  assert.equal(parseSize('3.18G'), 3.18 * 2 ** 30);
  assert.equal(parseSize('x'), null);
});

test('camlist: cameras only, no group nor system entry', () => {
  const cameras = parseCameras(fixture('camlist'));
  assert.deepEqual(
    cameras.map((camera) => camera.short),
    ['FrontDoor', 'Garden', 'Garage'],
  );
  const [front, garden, garage] = cameras;
  assert.equal(front.name, 'Front door');
  assert.equal(front.online, true);
  assert.equal(front.alertUtc, 1792087200 - 3 * 3600);
  assert.equal(garden.ptz, true);
  assert.equal(garage.online, false, 'no signal');
  assert.deepEqual(parseCameras({}), []);
  const disabled = parseCameras([{ optionValue: 'X', isEnabled: false, isOnline: true }]);
  assert.equal(disabled[0].online, false);
  assert.equal(disabled[0].alertUtc, null, 'no alertutc on old servers');
  assert.equal(parseCameras([{ optionValue: '+Y', optionDisplay: '+Yard' }])[0].name, 'Yard');
});

test('alerts: what the AI and the flags say', () => {
  const [cancelled, cat, person] = parseAlerts(fixture('alertlist'));
  assert.deepEqual(person.kinds, [DETECTIONS.PERSON, DETECTIONS.MOTION]);
  assert.equal(person.at, (1792087200 - 3 * 3600) * 1000);
  assert.equal(person.memo, 'person:89%');
  assert.deepEqual(cat.kinds, [DETECTIONS.ANIMAL, DETECTIONS.MOTION]);
  assert.equal(cancelled.cancelled, true);

  const kinds = (flags, memo = '') => parseAlert({ camera: 'c', date: 1, flags, memo }).kinds;
  assert.deepEqual(kinds(ALERT_FLAGS.AI_VEHICLE), [DETECTIONS.VEHICLE]);
  assert.deepEqual(kinds(0, 'car:80%,person:55%'), [DETECTIONS.PERSON, DETECTIONS.VEHICLE]);
  assert.deepEqual(kinds(ALERT_FLAGS.AUDIO), [DETECTIONS.AUDIO]);
  assert.deepEqual(kinds(ALERT_FLAGS.EXTERNAL), [DETECTIONS.EXTERNAL]);
  assert.deepEqual(kinds(ALERT_FLAGS.DIO | ALERT_FLAGS.MOTION), [
    DETECTIONS.EXTERNAL,
    DETECTIONS.MOTION,
  ]);
  assert.deepEqual(kinds(0), [DETECTIONS.OTHER]);
  assert.equal(parseAlert({ date: 1 }), null);
  assert.equal(parseAlert({ camera: 'c' }), null);
  assert.equal(parseAlerts({ alerts: [{ camera: 'c', date: 2 }] }).length, 1);
});

test('memo labels', () => {
  assert.deepEqual(memoLabels('person:89%,car:62%'), ['person', 'car']);
  assert.deepEqual(memoLabels('Person (91%) DOG'), ['person', 'dog']);
  assert.deepEqual(memoLabels(''), []);
  assert.deepEqual(memoLabels(null), []);
});

test('presets: the named ones, else the first ones numbered', () => {
  assert.deepEqual(parsePresets(fixture('ptz')), [
    { num: 1, name: 'Driveway' },
    { num: 2, name: 'Gate' },
  ]);
  assert.deepEqual(
    parsePresets({ presetnum: 20, presets: [] }).map((preset) => preset.num),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(parsePresets({ presets: [{ num: 3, desc: 'Porch' }] }), [
    { num: 3, name: 'Porch' },
  ]);
  assert.deepEqual(parsePresets({}), []);
});

test('rights and identity from the login data', () => {
  const info = parseServerInfo(fixture('login'));
  assert.equal(info.systemName, 'BLUEIRIS-PC');
  assert.equal(info.version, '5.9.9.33');
  assert.deepEqual(info.rights, { admin: false, changeProfile: true, ptz: true });
  assert.equal(info.profiles[1], 'Away');
  assert.equal(info.profiles.length, 8);
  assert.deepEqual(parseRights({ admin: true }), { admin: true, changeProfile: true, ptz: true });
  assert.deepEqual(parseRights({}), { admin: false, changeProfile: false, ptz: true });
  assert.deepEqual(parseServerInfo({ profiles: ['Inactive'] }).profiles.slice(0, 2), [
    'Inactive',
    null,
  ]);
});
