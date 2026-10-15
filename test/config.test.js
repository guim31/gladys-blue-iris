import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseProfileList, parseServer } from '../src/config.js';

test('the address takes the port field, unless it carries its own', () => {
  assert.deepEqual(parseServer('192.0.2.20'), {
    origin: 'http://192.0.2.20:81',
    label: '192.0.2.20:81',
  });
  assert.equal(parseServer('192.0.2.20', { port: 8081 }).origin, 'http://192.0.2.20:8081');
  assert.equal(parseServer('192.0.2.20:8000', { port: 8081 }).origin, 'http://192.0.2.20:8000');
  assert.equal(parseServer('bi.lan', { port: 80 }).origin, 'http://bi.lan');
  assert.equal(parseServer('192.0.2.20', { https: true }).origin, 'https://192.0.2.20:81');
  assert.equal(parseServer('https://bi.lan', { port: 443 }).origin, 'https://bi.lan');
  assert.equal(parseServer('http://192.0.2.20/').origin, 'http://192.0.2.20:81');
  assert.equal(parseServer('[2001:db8::20]').origin, 'http://[2001:db8::20]:81');
  assert.equal(parseServer('192.0.2.20', { port: 0 }).origin, 'http://192.0.2.20:81');
});

test('an address with credentials, a path or another scheme is refused', () => {
  for (const bad of [
    'admin:pass@192.0.2.20',
    'http://admin:pass@192.0.2.20',
    '192.0.2.20/ui3.htm',
    'rtsp://192.0.2.20',
    'not an address',
    '',
  ]) {
    assert.equal(parseServer(bad), null, bad);
  }
});

test('the defaults: nothing configured, French names, disarming off', () => {
  const config = normalizeConfig({});
  assert.equal(config.server, null);
  assert.equal(config.problem, 'noHost');
  assert.equal(config.refreshMs, 10_000);
  assert.equal(config.snapshotIntervalMs, 5 * 60_000);
  assert.equal(config.allowDisarm, false);
  assert.equal(config.holdProfile, true);
  assert.equal(config.language, 'fr');
  assert.equal(DEFAULT_CONFIG.allow_disarm, false);
});

test('a usable configuration, and what is missing otherwise', () => {
  const full = normalizeConfig({
    host: ' 192.0.2.20 ',
    port: 81,
    username: 'gladys ',
    password: ' spaced secret ',
    refresh_interval: '5',
    snapshot_interval: '0',
    allow_disarm: 'true',
    disarmed_profiles: 'Home; 3, home',
    language: 'de',
  });
  assert.deepEqual(full.server, {
    origin: 'http://192.0.2.20:81',
    label: '192.0.2.20:81',
    username: 'gladys',
    password: ' spaced secret ',
  });
  assert.equal(full.refreshMs, 5000);
  assert.equal(full.snapshotIntervalMs, 0);
  assert.equal(full.allowDisarm, true);
  assert.deepEqual(full.disarmedProfiles, ['home', '3']);
  assert.equal(full.language, 'de');
  assert.equal(normalizeConfig({ host: 'a:b@c' }).problem, 'invalidHost');
  assert.equal(normalizeConfig({ host: '192.0.2.20', username: 'x' }).problem, 'noCredentials');
  assert.equal(normalizeConfig({ host: '192.0.2.20', password: 'x' }).problem, 'noCredentials');
  assert.equal(normalizeConfig({ refresh_interval: '2', language: 'it' }).refreshMs, 10_000);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});

test('the disarmed profile list', () => {
  assert.deepEqual(parseProfileList(' Home , 4;Night\nhome'), ['home', '4', 'night']);
  assert.deepEqual(parseProfileList(undefined), []);
});
