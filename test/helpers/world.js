// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Blue Iris server (three
// cameras: Front door with an AI person alert in its history, Garden with
// PTZ, Garage offline), a temporary /data and a manual clock, with the
// integration wired on top through registerHandlers. No periodic timer runs
// unless `timers: true` (with node:test mock timers): the tests read the
// server with `world.hub.refresh()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeBlueIris, FLAGS, NOW_S, PASSWORD, USERNAME, network } from './fakeBlueIris.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const ORIGIN = 'http://192.0.2.20:81';

export const BASE_CONFIG = {
  host: '192.0.2.20',
  port: 81,
  use_https: false,
  username: USERNAME,
  password: PASSWORD,
  refresh_interval: '10',
  snapshot_interval: '5',
  hold_profile: true,
  allow_disarm: false,
  disarmed_profiles: 'Home',
  language: 'en',
};

/** A manual clock. */
export function createClock(start = NOW_S * 1000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the handlers and the fake network settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {FakeBlueIris} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] HUB_TIMINGS overrides
 */
export async function createWorld({
  clock = createClock(),
  server,
  config = BASE_CONFIG,
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-blue-iris-')),
  timings = {},
  timers = false,
} = {}) {
  const fake = server ?? new FakeBlueIris({ now: clock.now });
  const gladys = createFakeGladys({ config, devices: created });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network({ [ORIGIN]: fake }),
    timers,
    timings: { alertImageWaitMs: 200, ptzWatchdogMs: 50, ...timings },
    now: clock.now,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    server: fake,
    app,
    hub: app.hub,
    clock,
    dataDir,
    /** A new alert on a camera, read by the next refresh. */
    async alert(short, options) {
      fake.addAlert(short, options);
      clock.advance(1000);
      await app.hub.refresh();
      await settle();
    },
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return world;
}

export const serverIds = (gladys) => gladys.externalIds('server', 'server');
export const cameraIds = (gladys, short) => gladys.externalIds('camera', short);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

export const discovered = (world, externalId) =>
  world.fake.discoveredDevices.find((device) => device.external_id === externalId);

export { FakeBlueIris, FLAGS, NOW_S, PASSWORD, USERNAME };
