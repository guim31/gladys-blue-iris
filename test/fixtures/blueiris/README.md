# Blue Iris fixtures

Answers of the Blue Iris JSON interface (`POST /json`), served by the fake
server of the tests (`test/helpers/fakeBlueIris.js`). No Blue Iris server was
available while writing this integration: the shapes come from published
sources, the values are invented.

| File             | Command                         | Source of the shape                                                                                                                                                                                      |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login.json`     | `login` (the `data` of success) | UI3 (`HandleSuccessfulLogin`: `system name`, `admin`, `changeprofile`, `ptz`, `profiles`, `version`, `user`), kramttocs/ha-blueiris                                                                      |
| `status.json`    | `status`                        | the sample answer quoted in UI3 (`loadStatusInternal`), disks in MiB                                                                                                                                     |
| `camlist.json`   | `camlist`                       | the camera fields read by UI3 (`isOnline`, `isMotion`, `isTriggered`, `ptz`, `alertutc`, `newalerts`, `group`…) and the system entries `index` and `@index` of the Home Assistant integrations           |
| `alertlist.json` | `alertlist`                     | UI3 (`ClipData`: `camera`, `path`, `date` in epoch seconds, `flags`, `memo`, `clip`); the flags are UI3's `BIDBFLAG` (motion 1<<17, cancelled 1<<23, AI person 1<<26, AI vehicle 1<<27, confirmed 1<<28) |
| `ptz.json`       | `ptz` without a button          | the comment of UI3 `LoadPTZPresetDescriptions` (`presetnum`, `presets`)                                                                                                                                  |

Sources: [bp2008/ui3](https://github.com/bp2008/ui3) (the web interface shipped
with Blue Iris, LGPL-3.0: read, not copied),
[kramttocs/ha-blueiris](https://github.com/kramttocs/ha-blueiris) (Apache-2.0)
and [elad-bar/ha-blueiris](https://github.com/elad-bar/ha-blueiris) (no
license: read only).

Anonymized: the system name, the user and the camera names are invented,
addresses are in 192.0.2.0/24 (documentation range), the license field is
redacted. The alert dates are relative to the test clock
(2026-10-15T18:00:00Z, epoch 1792087200).
