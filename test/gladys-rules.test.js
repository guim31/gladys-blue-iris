// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/blueiris, after UI3 and the Home Assistant
// integrations): the server, a camera with an AI person alert, a PTZ camera
// with presets, an offline camera — before and after alerts (person,
// vehicle learned) and commands, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled and guim31/gladys-dahua.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BASE_CONFIG, FLAGS, createAll, createWorld, serverIds } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({
      config: { ...BASE_CONFIG, language: scenario.language, allow_disarm: true },
    });
    try {
      await createAll(world);
      // Alerts and commands, so the learned features and every value exist.
      await world.alert('Garden', { flags: FLAGS.MOTION | FLAGS.AI_VEHICLE, memo: 'car:80%' });
      await world.alert('FrontDoor', { flags: FLAGS.MOTION | FLAGS.AI_PERSON });
      await createAll(world);
      const server = world.fake.discoveredDevices.find(
        (device) => device.external_id === serverIds(world.gladys).device,
      );
      const signal = server.features.find((f) => f.external_id.endsWith(':signal'));
      await world.fake.setValue(server, signal, 'red');
      world.server.untrigger('Garden');
      world.server.untrigger('FrontDoor');
      world.clock.advance(60_000);
      await world.hub.refresh();

      const devices = world.fake.discoveredDevices;
      // The server and 3 cameras.
      assert.equal(devices.length, 4);
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          assert.equal(typeof feature.keep_history, 'boolean', `${at}: keep_history`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} for ${feature.category}`,
              );
            }
          }
          for (const option of feature.supported_options ?? []) {
            assert.ok(option.label && option.label.length <= 60, `${at}: option label`);
            if (feature.category !== 'text') {
              assert.ok(Number.isInteger(option.value), `${at}: integer option values`);
              assert.ok(
                option.value >= feature.min && option.value <= feature.max,
                `${at}: option ${option.value} out of bounds`,
              );
            }
          }
          if (feature.type === 'move') {
            assert.ok(
              !feature.supported_options.some((option) => option.value === 0),
              `${at}: stop is never an option`,
            );
          }

          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: feature id outside its device`,
          );
          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // Every value published fits the declared bounds; images and
          // commands have none.
          if (feature.category === 'camera') {
            continue;
          }
          const states = world.fake.states.filter(
            (entry) => entry.device_feature_external_id === feature.external_id,
          );
          for (const state of states) {
            if (feature.category === 'text') {
              assert.equal(typeof state.text, 'string', `${at}: text state`);
              assert.ok(state.text.length > 0, `${at}: empty text`);
              if (feature.type === 'select') {
                assert.ok(
                  feature.supported_options.some((option) => option.value === state.text),
                  `${at}: ${state.text} is not an option`,
                );
              }
              continue;
            }
            const value = state.state;
            assert.equal(typeof value, 'number', `${at}: non-numeric state`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            if (feature.unit === undefined) {
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}

test('every feature that has a value received one once the devices are added', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const published = new Set(world.fake.states.map((state) => state.device_feature_external_id));
    const missing = world.fake.discoveredDevices
      .flatMap((device) => device.features)
      .filter((feature) => feature.category !== 'camera' && !published.has(feature.external_id))
      .map((feature) => feature.external_id);
    assert.deepEqual(missing, []);
  } finally {
    await world.app.stop();
  }
});

test('the selects of profile and signal are never a switch', async () => {
  const world = await createWorld();
  try {
    for (const feature of world.fake.discoveredDevices.flatMap((device) => device.features)) {
      assert.notEqual(feature.category, 'switch', feature.external_id);
      assert.notEqual(feature.category, 'siren', feature.external_id);
      assert.notEqual(feature.category, 'lock', feature.external_id);
    }
  } finally {
    await world.app.stop();
  }
});
