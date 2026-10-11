# OpenKey

**An open-source, local-first keyboard configurator that runs in your browser.**

OpenKey talks to a keyboard directly over WebHID. There is no installer, no account, no server and no
telemetry: the deployment is static files, and everything you create stays in your browser. Keyboards
are supported through protocol adapters, and OpenKey says exactly what it has verified for each one.

**Live app:** https://openkey-lovat.vercel.app · **Try it without hardware:** open the app and click
_Try demo_.

> OpenKey is not universal yet. Today it configures the AJAZZ AK820 family; any other keyboard can be
> inspected read-only and reported so an adapter can be built. It never flashes firmware.

## What works today

| Area                                                    | State                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flagship: AJAZZ AK820 MAX / MAX PLUS (TFT), `0C45:8009` | Detection, protocol handshake and per-key colour read **verified on hardware**. Keymap, Fn layer, lighting, per-key write, macros, screen upload, clock and settings are implemented from the official driver and are **experimental** (opt-in) until verified on hardware. |
| Other AK820 variants                                    | Community or research status; see the Compatibility page.                                                                                                                                                                                                                   |
| AULA, ROYUAN, Vial                                      | Planned adapters: their descriptor signatures are recognised in unknown-device mode; nothing is sent.                                                                                                                                                                       |
| Any HID device                                          | Read-only inspection with an explained verdict and next safe step, sanitized diagnostic package, device-support request, offline analysis of diagnostic files.                                                                                                              |
| Demo                                                    | Full UI against a firmware simulator running the real protocol code.                                                                                                                                                                                                        |

Feature-level detail with evidence: [docs/HARDWARE_TEST_MATRIX.md](docs/HARDWARE_TEST_MATRIX.md),
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## How it works

```text
transport (WebHID) → device discovery (HID collections) → descriptor match → declared probe
(automatic only for identities known to accept it, otherwise after your consent) → family identified?
→ verdict → adapter → capabilities → normalized model → UI
```

- Detection never trusts VID/PID alone: `258A:010C` is used by two unrelated products.
- Every device gets a verdict — verified match, unverified firmware, strong candidate, resembles a
  family, inspection only, unknown … — with reasons, conflicting evidence, what was not observed, and
  the next safe step. A resemblance never unlocks a write: a driver exists only after the device
  answered a family-specific request.
- Every feature has a status (supported, read-only, write-only, fixed, hardware-only, research needed,
  not on this connection, unknown …) and an evidence level (VERIFIED, OBSERVED, INFERRED, HYPOTHESIS,
  UNKNOWN, NOT_TESTED).
- Every write has a safety level, goes through a diff and a confirmation, and is reported as _verified_
  only after it was read back from the device.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The app

Keymap studio (staged edits, undo/redo, searchable keycodes, diff before apply) · lighting and per-key
colour · macro studio · screen studio (images, GIFs, rotate, dither, timeline) · backup and restore with
read-back · local profiles · keyboard tester · latency lab (declared vs measured, never inferred) ·
research lab (inspector, protocol trace, report monitor, diagnostics) · compatibility center · command
palette (Ctrl/Cmd+K) · 11 languages · installable PWA that works offline.

Browser requirements: Chrome, Edge, Opera or Brave on Windows, macOS, Linux or ChromeOS for hardware
access; any modern browser (including phones) for the demo, offline analysis and tools. Windows and
macOS need no setup. On Linux the app detects a missing permission and walks you through a one-time
udev rule (downloadable installer you run yourself with `sudo`). Details:
[Windows](docs/PLATFORM_WINDOWS.md) · [macOS](docs/PLATFORM_MACOS.md) · [Linux](docs/PLATFORM_LINUX.md) ·
[browsers](docs/BROWSER_SUPPORT.md).

The screen studio includes a gallery of ten original animations generated by OpenKey (free to use),
loaded into the local preview with one click.

## Deploy

Static files only: Vercel (`vercel.json`), Netlify and Cloudflare Pages (generated `_headers`), Docker
(`docker build -t openkey . && docker run -p 8080:8080 openkey`, unprivileged nginx) or any web server.
Managed fleets can pre-approve OpenKey for specific keyboards with Chrome/Edge enterprise policies. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Privacy

No account, analytics, tracking or cloud storage. Typing is never captured outside the tester while you
run it. Diagnostic packages exclude typing, macros, keymaps and serial numbers. Read
[PRIVACY.md](PRIVACY.md).

## CLI (Linux)

```sh
pnpm openkey detect --verbose            # prints the verdict and next safe step
pnpm openkey analyze diagnostics.json    # offline analysis, no device needed
pnpm openkey info [--read-lighting]
pnpm openkey keymap set Caps=key:ctrl F12=consumer:mute [--layer fn] --experimental
pnpm openkey rgb set --effect Static --color '#ff0000' --brightness 5 --experimental
pnpm openkey verify per-key --experimental   # guided hardware verification with read-back
pnpm openkey backup | restore backup.json --dry-run
pnpm openkey polling        # measured report cadence
```

`openak820` remains an alias. The CLI applies the same write policy as the web app: writes that are not
yet verified on hardware need `--experimental`, every write asks for confirmation (or `--yes`) and
backs up first. Handshakes for identities that are not known to accept them need
`--allow-probe <adapter>`.

## Development

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # no hardware needed: simulators, fixtures, mock HID with fault injection
pnpm lint && pnpm typecheck
pnpm build      # static site in apps/web/dist + CLI
pnpm e2e        # browser smoke test of the build with production headers
```

Deployment is static (Vercel Hobby): `vercel.json` builds `apps/web` and sets the security headers.

Repository: `packages/` (core, hid, hid-node, protocols, devices, tft), `apps/web`, `tools/` (cli,
inspector, probe, packet-diff, capture, e2e), `devices/`, `fixtures/`, `re/` (raw evidence), `tests/`,
`docs/`.

## Contributing

Add a keyboard: [docs/CONTRIBUTING_KEYBOARDS.md](docs/CONTRIBUTING_KEYBOARDS.md) · write an adapter:
[docs/ADAPTER_GUIDE.md](docs/ADAPTER_GUIDE.md) · safety rules: [docs/SAFETY_INVARIANTS.md](docs/SAFETY_INVARIANTS.md) ·
reference keyboard: [docs/AK820_INVESTIGATION.md](docs/AK820_INVESTIGATION.md) · decisions:
[docs/ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md) · code and translations:
[CONTRIBUTING.md](CONTRIBUTING.md) · research: [docs/PROTOCOL_RESEARCH.md](docs/PROTOCOL_RESEARCH.md) ·
plan: [docs/ROADMAP.md](docs/ROADMAP.md) · security: [SECURITY.md](SECURITY.md).

If OpenKey is useful to you, a star on GitHub helps others find it.

## License

MIT ([LICENSE](LICENSE), [THIRD_PARTY.md](THIRD_PARTY.md), [docs/LICENSE_NOTES.md](docs/LICENSE_NOTES.md)).
Not affiliated with AJAZZ, AULA or any keyboard brand; names are trademarks of their owners. OpenKey does
not distribute proprietary firmware or driver binaries.
