# Project audit — 2026-10-11

State of the repository at the start of the evidence-platform upgrade, what changed, and what remains.
The previous audit (2026-10-08, before the OpenKey migration) is [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md).

## 1. Baseline (before any change)

Working tree clean on `main` at `e33c16a`. The machine had no Node.js; Node 24.21.0 LTS was installed
locally under `~/.local/opt` (checksum verified, no system changes) and pnpm 10.0.0 used via corepack,
as pinned by `packageManager`.

| Check | Command | Result |
| ----- | ------- | ------ |
| Lint | `pnpm lint` | pass |
| Types | `pnpm typecheck` | pass |
| Tests | `pnpm test` | pass, 16 files, 147 tests |
| Build | `pnpm build` (CLI + web) | pass |
| Browser smoke test | `pnpm e2e` | not run at baseline; run after the changes (pass) |

## 2. Repository facts that differ from the brief

| Brief assumed | Repository shows |
| ------------- | ---------------- |
| Project identity "OpenAK820"; rename later | The user-facing product, packages (`@openkey/*`) and docs were already renamed to OpenKey on 2026-10-08 (commit `5ded1ff`); the repository and CLI alias keep OpenAK820. Left as is: see [ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md#decisions-taken-in-this-session). |
| The all-zero `HIDIOCGFEATURE` reads are unexplained | Resolved on 2026-10-07: GET_FEATURE returns the echo of the last command; START `04 18` was acknowledged as `04 18 00 01` on the hardware ([AK820_INVESTIGATION.md](AK820_INVESTIGATION.md#4-the-all-zero-feature-reads-resolved)). |
| Next.js static export | Vite + React SPA; same static deployment model ([ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md#framework-and-build)). |
| Fixtures A and B may exist | They did not; created from the brief's sanitized records as `fixtures/diagnostics/unknown-a-258a-015e.json` and `unknown-b-3151-6000.json`, with unrecorded fields left null. |

## 3. Inventory by proof

### Implemented and verified on hardware (AK820 MAX PLUS, fw 1.07, USB, Linux CLI)

Descriptor detection; START handshake; per-key colour read (`04 F5`); acknowledgement echo semantics;
declared bInterval. Fixtures: `fixtures/device-info/*-hw.json`, `fixtures/rgb/*-hw.json`.

### Implemented and tested against simulators or fixtures only

- `sonix-feature` writes: keymap, Fn layer, lighting, per-key write, real-time colour, macros, TFT
  image/GIF, clock, settings, defaults (all OBSERVED from the official driver; experimental opt-in).
- `sonix-aa55` (online-driver family): read/write with read-back against its simulator.
- `sonix-dongle`: ping, battery, lighting packet (never run on a receiver).
- Backup v2 with v1 migration and read-back restore; transactions; undo/redo; state machine; support
  bundles; cadence statistics; TFT pipeline; i18n catalogues; PWA; security headers (smoke-tested).

### UI or simulation only

- The web **demo** runs the real protocol code against `SonixFeatureSimulator`; it is labelled as a
  simulation and (since this upgrade) never shows a hardware-verified badge.
- The web app has never been run against a real keyboard (WebHID path untested on hardware).

### Planned or incomplete

- `crs-aa55cc33`: identification only (no documented read-only command).
- Planned signatures: AULA/SinoWealth, ROYUAN, Vial (no I/O).
- `qmk-via`: identification only.
- Translations beyond English and Bangla are partial.

### Defects found in this audit (all fixed in this session)

| # | Defect | Risk | Fix |
| - | ------ | ---- | --- |
| 1 | An adapter whose probe was *skipped* could still be selected and get a driver; CRS lighting writes were reachable from VID + one collection | write path from descriptor similarity | drivers now require `ProbeResult.identified` (`openDriver`); CRS is identification-only |
| 2 | At handshake level, START was sent automatically to any device with an FF13:0001 64-byte feature collection, and GET_DEVICE_INFO to any small FF00/FF01/FF68 in/out collection, whatever the identity | unconsented packets to unknown hardware | `ProbePlan.autoConsent` + explicit consent; identities limited to those the vendor software targets |
| 3 | The AA/55 matcher ignored report IDs; fixture B (report ID 186) would have received AA/55 frames under report ID 186 | guessed framing | matcher requires unnumbered reports, as every documented AA/55 device uses |
| 4 | CLI writes ignored the experimental policy (y/N only) | unverified writes without opt-in | `guardWrites` driver proxy in CLI and web; `--experimental` required |
| 5 | Restoring a backup from another model applied slot-indexed tables with only a warning | keys/LEDs land on wrong positions | slot-indexed sections skipped unless explicitly allowed |
| 6 | Unknown-device page claimed "no probes are sent" although probes had run before reaching it | misleading UI | text now reflects the number of reports actually sent |
| 7 | The demo overview showed "Verified (hardware-verified handshake)" for a simulator | simulation shown as hardware evidence | SIMULATED verdict; no hardware badge for simulators |

### Remaining risks

- No write has been verified on hardware; every AK820 write remains experimental.
- `0C45:800A` is used by both the AK820 MAX driver config and the Epomaker × AULA F75 Max; their
  product strings decide auto-consent, and an untested model is FIRMWARE_UNVERIFIED.
- The real-hardware WebHID path (Chromium grouping of interfaces, report-ID prefixes) is untested.
- The `04 27` meaning conflicts between two sources (Fn table vs lighting reset).

## 4. Results after the upgrade

See [ROADMAP.md](ROADMAP.md#upgrade-checklist-2026-10-11) for the checklist and the final command results.
