# Browser support

OpenKey is a static web app. The _application_ runs in any modern browser; _talking to a keyboard_
needs WebHID.

| Capability                                                                 | Requirement                                                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| App shell, demo, tester, compatibility center, settings, profiles, backups | any modern browser with ES2022 and IndexedDB                                                         |
| Connect a keyboard / inspect a device                                      | WebHID: Chrome, Edge, Opera, Brave and other Chromium browsers on Windows, macOS, Linux and ChromeOS |
| Offline use                                                                | a browser with service workers (after one online visit)                                              |
| Install as an app                                                          | browsers that support PWA installation                                                               |

Not available: Firefox and Safari do not implement WebHID; mobile browsers (Android, iOS) do not expose
it either. The landing page detects this and offers the demo instead.

## Secure context

WebHID works only over HTTPS or on `http://localhost`. The production deployment is HTTPS; `pnpm dev`
serves on localhost.

## What the browser allows and hides

- A site sees a HID device only after the user picks it in the browser's chooser, per origin. Revoke
  access in `chrome://settings/content/hid`.
- Chromium blocks reports from standard keyboard and mouse collections (protected usages), so OpenKey
  cannot read typing over WebHID; the keyboard tester uses ordinary DOM key events while it is running.
- WebHID does not expose USB interface numbers, endpoint intervals (bInterval), bcdDevice or the serial
  number on every platform. The Linux CLI shows these.
- Two identical keyboards plugged in at once are listed as one product name; connect one at a time.

## Security headers and WebHID

The deployment sends `Permissions-Policy: hid=(self)` (WebHID allowed for OpenKey's own origin, denied
to embedded content) and a strict CSP. Both are checked by the smoke test, which also asserts that the
policy still allows `hid`.

## Offline

The service worker precaches the whole app (a few hundred kB) after the first visit. Offline, every
page, the demo and the tools work. Hardware access still depends on the browser and the device; the
service worker cannot make a keyboard reachable.
