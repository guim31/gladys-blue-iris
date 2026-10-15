# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- **Secrets**: the password of the Blue Iris user lives in the Gladys
  configuration of the integration (a `secret` field). It is used only to
  answer the login challenge of the configured server
  (`md5("user:session:password")`: the password itself never travels), and is
  never written to the logs, to `/data` or to an error message. The session id
  Blue Iris returns is kept in memory only and never logged. An address typed
  with credentials (`user:pass@host`) is refused. A password refused once is
  never tried again without the user, so Blue Iris does not ban Gladys.
- **`/data`**: the only file is `blue-iris-state.json`: the system name, the
  version, the profile names and the rights of the user, the cameras (short
  name, name, PTZ presets, AI detections seen). No secret, no image.
- **Network**: the integration talks only to the configured server (HTTP, or
  HTTPS when asked; Blue Iris on a LAN only has a self-signed certificate,
  which is then accepted without check), never to a cloud.
- **Safety**: disarming (red signal, profile 0 "Inactive", the profiles listed
  as disarmed) is disabled by default and is never a switch; a PTZ move is
  bounded by a watchdog.
- **Camera images** stay in memory (the last ones, for the widget) and go to
  Gladys only.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Blue Iris and the cameras (report those to Perspective Software and the
camera makers).
