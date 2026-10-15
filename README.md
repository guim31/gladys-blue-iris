# Blue Iris for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **Blue Iris**,
the video security software for Windows, **locally**, through its JSON
interface (the one its own web interface UI3 uses). No cloud account, nothing
leaves your network.

> **Developed without the hardware: feedback welcome.** No Blue Iris server was
> available to write this integration: it was built from the JSON interface as
> the web interface of Blue Iris and the Home Assistant integrations use it,
> and is covered by tests against a simulated server. Please report what works
> and what does not in the [issues](https://github.com/guim31/gladys-blue-iris/issues).

## Features

- **Cameras**: one Gladys device per Blue Iris camera (groups left out): image
  (refreshed on a timer, at each alert and on demand), online, motion,
  triggered, and person / vehicle confirmed by the AI of Blue Iris (they
  appear once the AI reported one).
- **PTZ**: the Gladys `move` feature (dashboard arrows and zoom, a move stops
  by itself after 2 s) and the presets saved in Blue Iris.
- **Server**: active profile and arming signal (green, yellow, red) as
  commands, CPU load, clip storage used and free space.
- **Safety**: arming is always allowed; **disarming** (red signal, profile 0
  "Inactive" or the profiles you list) is **disabled by default**, like an
  alarm, and never a switch.
- **Scene trigger**: _Alert on a Blue Iris camera_, filtered by camera and by
  what was seen (person, vehicle, animal, motion, sound, external trigger),
  with the AI labels as a variable. The camera image is refreshed in Gladys
  before the scene starts.
- **Scene actions**: _Change the Blue Iris profile_ (by name or number), _Arm
  or disarm Blue Iris_, _Trigger a Blue Iris camera_, _Refresh a camera image_.
- **Dashboard widget** _Blue Iris_: profile, armed or not, cameras online,
  alerts of the last 24 hours with their image, and Arm / Disarm (when
  allowed) / Trigger buttons.
- **Configuration action**: _Test the connection_ (server, cameras, profile,
  rights of the user).
- Four languages: English, French, German, Spanish.

## Requirements

- Blue Iris 5 or later with its web server on, reachable from Gladys (port 81
  by default).
- A dedicated Blue Iris user for Gladys: a plain (non-administrator) user is
  enough to read; give it the "change profiles" right to arm from Gladys, the
  PTZ right to move the cameras; triggering a camera needs an administrator.
- Gladys Assistant **5.1.0 or later**.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-blue-iris`
   (or install **Blue Iris** from the catalog once it is listed).
2. In **Configuration**, enter the address of the Blue Iris PC, the port, the
   user name and the password, save, then click **Test the connection**.
3. Open the **Discover** tab and add the server and the cameras.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **API**: `POST /json` with `{ cmd, session, … }`. Login: `{ cmd: "login" }`
  returns a challenge session, then `response = md5("user:session:password")`
  (the password itself never travels). Reads: `status` (profile, signal, lock,
  CPU, disks), `camlist` (cameras, motion, trigger, time of the last alert),
  `alertlist` (alert records with their flags and AI memo), `ptz` (presets).
  Commands: `status` with `profile` or `signal`, `trigger`, `ptz` with a
  button (`updown` 1/0 for a move). Images: `GET /image/<camera>?w=&q=`, scaled
  by Blue Iris itself.
- **Passwords**: Blue Iris can ban an address after wrong passwords, so a
  password refused once is never tried again on its own; an expired session is
  renewed once.
- **Refresh**: devices are published with `should_poll: false`; the container
  reads `status` and `camlist` on its own timer (10 s by default), and the
  alert list only for a camera whose last alert time moved — Gladys never
  polls (GladysAssistant/Gladys#3198). Two requests in flight at most.
- **Alerts**: at start, the alerts of the last 24 hours are the baseline (they
  fire nothing, and tell which cameras have an AI); then each new alert kept by
  Blue Iris fires one scene event, after a fresh image.
- **Profiles**: a profile set from Gladys is sent twice to be held, as Blue
  Iris does when its profile button is pressed again (configurable).
- **PTZ**: a move is started with `updown: 1` and stopped with `updown: 0`, on
  the release of the dashboard button or by a 2-second watchdog (a lost stop
  never leaves a camera turning); a preset is button 100 + n.
- **States**: `publishChangedStates`, only the changes, plus a heartbeat every
  6 hours; only for the devices added to Gladys.
- **Images**: Gladys takes 150 KB per camera image: the integration asks Blue
  Iris for 1280 px, then 960, 640, 480 px until it fits. No image library.
- **Persistence**: `/data/blue-iris-state.json` keeps the server identity,
  profile names, rights and cameras (PTZ presets, AI detections seen), so a
  server off at start keeps its devices. Nothing secret.
- **Logs**: the lifecycle only at info level; a repeated failure is logged
  once, and once when it clears; `LOG_LEVEL=debug` shows the rest. Never a
  password nor a session id.

## What could not be checked

No Blue Iris server and no Gladys instance were available: the tests run
against the SDK's fake Gladys and a simulated Blue Iris built from published
shapes (`test/fixtures/blueiris/`). Not checked for real:

- the exact answer of `alertlist` with `view: "alerts"` on every version, and
  the AI flags (`1<<26` person, `1<<27` vehicle) as Blue Iris sets them;
- the `lock` value after one and two profile commands (taken from the Home
  Assistant integrations and UI3: 1 held, 2 temporary);
- the permission a plain user needs for `alertlist` and `trigger`, and the
  reason texts of the refusals;
- the arming by `signal: 1` (UI3 sends 2, yellow, when arming; green is sent
  here as the explicit armed state);
- the image size parameters on cameras with odd aspect ratios.

A read-only probe is provided for a real server:
`BLUE_IRIS_PASSWORD=… node scripts/probe.mjs 192.168.1.20 [user] [port]`
prints the identity, the rights, the profiles, the field names of each answer,
the cameras, the alerts of the last 24 hours, the PTZ presets and the image
sizes, without the password, the session, the license or the camera
addresses. It changes nothing on the server.

## Limitations

- One Blue Iris server per integration; groups of cameras are not devices.
- No live video stream, no clip playback, no DIO outputs, no schedule change.
- Motion and alerts are seen at the refresh pace (10 s by default): Blue Iris
  pushes events by MQTT or web calls, which the bridged sandbox of Gladys
  cannot receive.
- The widget keeps its alert list in memory (after a restart, the last 24
  hours without images).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a simulated Blue Iris (`test/helpers/fakeBlueIris.js`) that checks the MD5
login, expires sessions and holds profiles like the real server. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

### Releasing

Describe each change under `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md), then **Actions → Release → Run workflow**
(`patch`, `minor` or `major`): the workflow bumps the version everywhere, moves
the changelog section, tags, builds the multi-arch image to `ghcr.io` and
publishes the GitHub Release.

> A hand-pushed tag (`git tag v1.2.3 && git push --tags`) triggers the same
> build and Release, but does **not** bump anything: update `version` in
> `package.json` and in `gladys-assistant-integration.json` (with the
> `docker_image` tag) and commit it before tagging.

## Credits

- [kramttocs/ha-blueiris](https://github.com/kramttocs/ha-blueiris)
  (Apache-2.0, kramttocs) and [elad-bar/ha-blueiris](https://github.com/elad-bar/ha-blueiris)
  (Elad Bar; no license file, read only), the Home Assistant integrations for
  Blue Iris: the login, the commands, the system camera ids, the profile hold
  by a second command, the AI labels.
- [bp2008/ui3](https://github.com/bp2008/ui3) (LGPL-3.0, Brian Pearce), the web
  interface shipped with Blue Iris: the status sample, the camera and alert
  fields, the alert flags, the PTZ buttons and their `updown` semantics, the
  rights of the login data. Read to understand the protocol; no code copied.
- The architecture, the conformity tests and the quiet logs follow
  [gladys-dahua](https://github.com/guim31/gladys-dahua),
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Perspective
Software. Blue Iris is a trademark of its owner.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
