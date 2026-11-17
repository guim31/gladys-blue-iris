# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-11-17

### Changed

- Integration SDK 0.16.1.

## [1.0.1] - 2026-10-15

### Added

- Blue Iris integration, local only, through the JSON interface of Blue Iris
  (MD5 challenge login, a refused password never retried).
- One device per camera: image, online, motion, triggered, and person /
  vehicle confirmed by the AI of Blue Iris (appearing once reported).
- PTZ cameras: pan, tilt, zoom from the dashboard (bounded by a 2-second
  watchdog) and the presets saved in Blue Iris.
- A Blue Iris server device: active profile and arming signal as commands,
  CPU load, clip storage used and free space. Disarming (red signal, profile 0
  or the profiles listed as disarmed) is disabled by default.
- Scene trigger "Alert on a Blue Iris camera", filtered by camera and by what
  was seen, with a fresh camera image.
- Scene actions: change the profile, arm or disarm, trigger a camera, refresh
  a camera image.
- Dashboard widget: profile, armed or not, cameras online, last alerts with
  their image, arm / disarm / trigger buttons.
- "Test the connection" action, four languages (English, French, German,
  Spanish), documentation in the four.

[Unreleased]: https://github.com/guim31/gladys-blue-iris/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-blue-iris/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-blue-iris/releases/tag/v1.0.1
