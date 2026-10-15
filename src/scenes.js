// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
//   - set_profile: switch Blue Iris to a profile, by number or name ("Away"
//     when the house alarm is armed). Profile 0 "Inactive" and the profiles
//     listed as disarmed in the configuration only once disarming is allowed;
//   - set_signal: arm (green) or disarm (red, same rule) the shield;
//   - trigger_camera: trigger a camera as its "trigger now" button does
//     (recording and alerts per the camera's settings in Blue Iris);
//   - refresh_snapshot: a fresh image of a camera, sent to Gladys, so the next
//     action ("send the camera image" in a message) sends what it sees now.
// Gladys applies the field defaults to scene actions; a failure throws, the
// scene logs it and carries on. No action fires a scene event (no loop).
// -----------------------------------------------------------------------------

import { SIGNALS } from './blueiris/model.js';

// Choices of the set_signal field (yellow is a transition of Blue Iris).
export const SCENE_SIGNALS = Object.freeze([SIGNALS.GREEN, SIGNALS.RED]);
export const DEFAULT_SCENE_SIGNAL = SIGNALS.GREEN;
export const DEFAULT_SCENE_PROFILE = '1';

export const SCENE_ACTIONS = {
  async set_profile(hub, { fields = {} }) {
    await hub.setProfile(fields.profile ?? DEFAULT_SCENE_PROFILE);
  },

  async set_signal(hub, { fields = {} }) {
    await hub.setSignal(fields.signal ?? DEFAULT_SCENE_SIGNAL);
  },

  async trigger_camera(hub, { fields = {} }) {
    await hub.triggerCamera(fields.camera);
  },

  async refresh_snapshot(hub, { fields = {} }) {
    await hub.refreshSnapshot(fields.camera);
  },
};
