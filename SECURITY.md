# Security policy

## Reporting a vulnerability

Report security problems privately through GitHub's **Report a vulnerability** (security advisories) for
this repository, not in a public issue. Include steps to reproduce and the affected version.

## Scope

**Web app.** Static files, no server-side code, no secrets, no API. The app makes no network requests of
its own except loading its own files; GitHub links open only on click. Local data lives in IndexedDB and
`localStorage` of the user's browser ([PRIVACY.md](PRIVACY.md)).

Deployed response headers (configured in `vercel.json`, verified on the live deployment and in CI):

| Header                     | Value / purpose                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content-Security-Policy    | `default-src 'self'`; scripts and styles only from the site, no inline code; `object-src 'none'`; `frame-ancestors 'none'`; `form-action 'none'` |
| Permissions-Policy         | `hid=(self)` — WebHID for this origin only; `usb`, `serial`, `bluetooth`, camera, microphone, geolocation, payment, display capture denied       |
| X-Content-Type-Options     | `nosniff`                                                                                                                                        |
| Referrer-Policy            | `no-referrer`                                                                                                                                    |
| X-Frame-Options            | `DENY` (with CSP `frame-ancestors 'none'`)                                                                                                       |
| Cross-Origin-Opener-Policy | `same-origin`                                                                                                                                    |

**Device safety.** Which commands OpenKey sends and never sends is in [docs/security.md](docs/security.md).
OpenKey contains no firmware, bootloader, erase or calibration commands. Reports that a crafted page or
backup could make OpenKey send such a command are in scope.

**CLI.** Runs locally with the user's permissions; stores mirrors and backups under `~/.config/openkey/`
(or the earlier `~/.config/openak820/` when it exists). Linux access is granted by the udev rule in
`udev/`.

## Supply chain

Runtime dependencies are React, React DOM and gifuct-js (bundled), plus node-hid for the CLI. The
lockfile is committed and CI installs with `--frozen-lockfile`.
