// -----------------------------------------------------------------------------
// The `blue_iris` widget: within the core budget (validateWidgetContent of
// the SDK), its images served, its buttons — arm always, disarm only when
// allowed (with a confirmation), trigger for the chosen camera.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import {
  BASE_CONFIG,
  FLAGS,
  FakeBlueIris,
  cameraIds,
  createAll,
  createWorld,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const content = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered exactly as sent');
  return ack.data.content;
};

const buttons = (widget) => widget.components.filter((c) => c.type === 'button');

test('the widget: profile, armed, cameras online, alerts with their image', async (t) => {
  const w = await world(t);
  await createAll(w);
  await w.alert('FrontDoor', { flags: FLAGS.MOTION | FLAGS.AI_PERSON, memo: 'person:90%' });
  const widget = await content(w);
  const tiles = widget.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.label, tile.value]),
    [
      ['Profile', 'Away'],
      ['Surveillance', 'Armed'],
      ['Cameras online', '2/3'],
      ['Alerts 24 h', 3],
    ],
  );
  const list = widget.components.find((c) => c.type === 'card-list');
  assert.equal(list.items[0].title, 'Person · Front door');
  assert.ok(list.items[0].image, 'the newest alert has its image');
  assert.equal(list.items.length, 3);
  const image = await w.fake.widgetGetImage(list.items[0].image);
  assert.equal(image.success, true);
  assert.deepEqual(validateWidgetImage(image.data.image), []);
  // Armed, disarming not allowed: no button.
  assert.deepEqual(buttons(widget), []);
});

test('not armed: an "Arm" button that arms', async (t) => {
  const w = await world(t);
  w.server.status.signal = '0';
  await w.hub.refresh();
  const widget = await content(w, {}, 'fr');
  assert.deepEqual(
    buttons(widget).map((b) => [b.label, b.action.key]),
    [['Armer', 'arm']],
  );
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'arm', {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.server.status.signal, '1');
});

test('"Disarm" only when allowed, with a confirmation; refused otherwise', async (t) => {
  const refused = await world(t);
  const ack = await refused.fake.widgetAction(WIDGET_KEY, 'disarm', {}, { settings: {} });
  assert.equal(ack.success, false);
  assert.equal(refused.server.status.signal, '1');

  const w = await world(t, { config: { ...BASE_CONFIG, allow_disarm: true } });
  const widget = await content(w);
  const [disarm] = buttons(widget);
  assert.equal(disarm.action.key, 'disarm');
  assert.equal(disarm.action.confirm, true);
  assert.equal(disarm.style, 'danger');
  assert.equal(
    (await w.fake.widgetAction(WIDGET_KEY, 'disarm', {}, { settings: {} })).success,
    true,
  );
  assert.equal(w.server.status.signal, '0');
});

test('one camera chosen: its counts, and a trigger button for an administrator', async (t) => {
  const w = await world(t, { server: new FakeBlueIris({ rights: { admin: true } }) });
  const camera = cameraIds(w.gladys, 'Garden').device;
  const widget = await content(w, { camera });
  const online = widget.components.find((c) => c.label === 'Cameras online');
  assert.equal(online.value, '1/1');
  const trigger = buttons(widget).find((b) => b.action.key === 'trigger');
  assert.deepEqual(trigger.action.params, { camera });
  const ack = await w.fake.widgetAction(
    WIDGET_KEY,
    'trigger',
    { camera },
    { settings: { camera } },
  );
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.server.triggers, ['Garden']);
});

test('the empty and broken states', async (t) => {
  const empty = await world(t, { config: {} });
  const configure = await content(empty);
  assert.match(configure.components[0].text, /Enter the address/);

  const w = await world(t);
  const unknown = await content(w, { camera: 'ext:test-integration:camera:nope' });
  assert.match(unknown.components[0].text, /no longer in Blue Iris/);
  w.server.online = false;
  await w.hub.refresh();
  const offline = await content(w);
  assert.match(offline.components[0].text, /does not answer/);
  assert.deepEqual(buttons(offline), []);
});

test('the widget in every language fits the budget', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, allow_disarm: true } });
  for (const language of ['en', 'fr', 'de', 'es']) {
    await content(w, {}, language);
    await content(w, { camera: cameraIds(w.gladys, 'Garden').device }, language);
  }
});
