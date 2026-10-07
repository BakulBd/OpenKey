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
| Any HID device                                          | Read-only inspection, sanitized diagnostic package, device-support request.                                                                                                                                                                                                 |
| Demo                                                    | Full UI against a firmware simulator running the real protocol code.                                                                                                                                                                                                        |

Feature-level detail with evidence: [docs/HARDWARE_TEST_MATRIX.md](docs/HARDWARE_TEST_MATRIX.md),
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## How it works

```text
transport (WebHID) → device discovery (HID collections) → protocol detection (descriptors + one
read-only handshake) → adapter → capabilities → normalized model → UI
```

- Detection never trusts VID/PID alone: `258A:010C` is used by two unrelated products.
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

Browser requirements: Chrome, Edge, Opera or Brave on a desktop OS for hardware access; any modern
browser for the demo and tools. See [docs/BROWSER_SUPPORT.md](docs/BROWSER_SUPPORT.md). On Linux, install
the udev rule: [docs/PLATFORM_LINUX.md](docs/PLATFORM_LINUX.md).

## Privacy

No account, analytics, tracking or cloud storage. Typing is never captured outside the tester while you
run it. Diagnostic packages exclude typing, macros, keymaps and serial numbers. Read
[PRIVACY.md](PRIVACY.md).

## CLI (Linux)

```sh
pnpm openkey detect --verbose
pnpm openkey info [--read-lighting]
pnpm openkey keymap set Caps=key:ctrl F12=consumer:mute [--layer fn]
pnpm openkey rgb set --effect Static --color '#ff0000' --brightness 5
pnpm openkey backup | restore backup.json --dry-run
pnpm openkey polling        # measured report cadence
```

`openak820` remains an alias. Every write asks for confirmation (or `--yes`) and backs up first.

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

Add a keyboard: [docs/CONTRIBUTING_KEYBOARDS.md](docs/CONTRIBUTING_KEYBOARDS.md) · code and translations:
[CONTRIBUTING.md](CONTRIBUTING.md) · research: [docs/PROTOCOL_RESEARCH.md](docs/PROTOCOL_RESEARCH.md) ·
plan: [docs/ROADMAP.md](docs/ROADMAP.md) · security: [SECURITY.md](SECURITY.md).

If OpenKey is useful to you, a star on GitHub helps others find it.

## License

MIT ([LICENSE](LICENSE), [THIRD_PARTY.md](THIRD_PARTY.md), [docs/LICENSE_NOTES.md](docs/LICENSE_NOTES.md)).
Not affiliated with AJAZZ, AULA or any keyboard brand; names are trademarks of their owners. OpenKey does
not distribute proprietary firmware or driver binaries.
