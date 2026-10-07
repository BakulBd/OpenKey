# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" (security advisories)
for this repository instead of opening a public issue. Include steps to reproduce and the affected version.

## Scope

- The web app runs entirely in the browser, makes no network requests of its own and stores mirrors and
  preferences only in `localStorage`. Device access is granted per origin by the browser's HID chooser and
  can be revoked in the browser settings (`chrome://settings/content/hid`).
- The CLI stores mirrors and backups under `~/.config/openak820/`.
- Device safety (which commands are never sent) is described in [docs/security.md](docs/security.md).
