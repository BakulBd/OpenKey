# Changelog

## Unreleased — platforms, deployment, screen gallery

- Linux: the app detects "listed but cannot be opened", shows **Linux setup required** with a
  downloadable installer (`udev/install-openkey-udev.sh`: embedded rule, explicit `sudo`, dry-run,
  uninstall, backup) and the rule file, then retries the same device; per-OS setup guide for Windows,
  macOS, Linux and ChromeOS.
- Screen studio: gallery of ten original, seamlessly looping animations (`@openkey/tft` gallery),
  frame timing collapsed with an "all frames" control.
- CLI on macOS and Windows through node-hid enumeration (`enumerateNodeHid`); Linux keeps sysfs.
- Deployment: `_headers` for Netlify/Cloudflare generated from `vercel.json`; Dockerfile with
  unprivileged nginx and a generated header snippet; CI on Ubuntu, Windows and macOS plus a container
  job; `.gitattributes` for LF; deployment guide with Chrome/Edge enterprise policies.

## Unreleased — UX phase

### Web app

- Status bar, device home with capability-driven tasks, verdict with detection evidence, collapsible
  capabilities and technical details.
- Change bar with precise configuration states on every editor; persistent outcomes for screen upload and
  clock; unsaved-change guard on navigation, disconnect and unload.
- Keymap editor: assigned actions on keycaps, key inspector (revert, reset, changed-from), only
  encodable action kinds offered, full-layer validation, change plan before writing, physical controls
  from capabilities, phone scroll hint.
- Lighting workspace (effects + per-key tabs); profiles review dialog; styled, validated file inputs.
- Connection journey: environment checks, devices already allowed, progress, last failure.
- Device Lab: identification evidence, import preview, diagnostic comparison, sanitized re-download,
  research notes (excluded unless chosen), issue text.
- Design tokens (spacing, type, controls, layers, motion), coarse-pointer targets, AA contrast, accessible
  off-canvas navigation.

### State and safety

- Session epoch, single-flight operation lock, structured errors (`BUSY`), write revision for editors
  affected by another editor's write.
- Drivers declare key-action kinds; the flagship no longer offers system actions it cannot encode.

### Tests

- Operation lock, configuration status, status summary, capability presentation, key-action kinds,
  diagnostic comparison; browser test for physical-session writes, unplug mid-write, accessibility audit,
  phone width.

## Unreleased — evidence platform

### Safety

- Handshakes run automatically only for identities where they are known to be harmless (the vendor's
  own software targets them, or a public-specification read); other devices need the user's consent
  after seeing the exact bytes (`ProbePlan`, `detect({ consent })`, CLI `--allow-probe`).
- No driver without family identification (`ProbeResult.identified`, `openDriver`). The CRS family is
  identification-only.
- AA/55 matcher requires unnumbered reports (a numbered 31-byte collection was eligible before).
- `guardWrites`: the CLI now enforces the same write policy as the web app (`--experimental` for
  unverified writes).
- Backups from another model skip keymaps and per-key colours unless explicitly allowed.
- Simulators are never shown with a hardware-verified badge.

### Platform

- Adapter contract v1 (`ADAPTER_API_VERSION`): probe plans, verified identities, licence,
  limitations, fixtures; the registry rejects other versions.
- Detection verdicts with reasons, conflicts, unobserved signals and the next safe action.
- Diagnostic package v2 (structured reports) with a bounded, sanitizing importer; offline analysis in
  the research lab and `openkey analyze`.
- Conformance kit, template adapter, `sonix-feature` evidence ledger with enforcement tests.
- `openkey verify per-key`: guided hardware verification with an evidence record.
- Fixtures A (`258A:015E`) and B (`3151:6000`) as unknown-device regression guards; AK820 descriptor
  diagnostic.
- Docs: project audit, competitive research, architecture decision, AK820 investigation, safety
  invariants, adapter guide, formats, third-party record.

## 0.2.0 — 2026-10-08 — OpenAK820 becomes OpenKey

### Architecture

- Renamed to OpenKey; packages under `@openkey/*`; device definitions moved to `devices/`
  (`@openkey/devices`). Old names kept where persisted: the `openak820` CLI alias, `~/.config/openak820`,
  `OPENAK820_DEBUG`, OpenAK820 v1 backups, browser mirrors in `localStorage`.
- One evidence vocabulary: VERIFIED, OBSERVED, INFERRED, HYPOTHESIS, UNKNOWN, NOT_TESTED.
- Capability states extended (SUPPORTED, WRITE_ONLY, TRANSPORT_LIMITED, FIRMWARE_LIMITED, UNVERIFIED …);
  `knob` became the generic `encoder` capability; new generic capabilities (profiles, debounce, actuation,
  rapid trigger, SOCD, DKS, calibration, analog, firmware) default to UNKNOWN.
- Safety level per operation and `writeDecision()`; transactions with device read-back verification;
  undo/redo history; connection state machine; explainable device fingerprints; adapter manifests;
  planned AULA, ROYUAN and Vial adapters (signature only, no I/O); sanitized support bundles; cadence
  statistics; searchable keycode catalogue; backup format v2.
- MockHidDevice fault injection (timeout, corruption, disconnect, reset).

### Fixes

- `sonix-feature` accepted an acknowledgement that did not echo its command (could be a stale echo).
- Web typecheck/build was broken by a removed capability id.
- The polling capability no longer presents bInterval as a "1000 Hz" rate.
- The catalogue no longer calls AK820 models "supported" before any write is verified.

### Web app

- New shell, landing page, demo, unknown-device mode, keymap/lighting/per-key/macro/screen studios,
  backup/restore, profiles, keyboard tester, latency lab, research lab, compatibility center, settings,
  command palette, 11 languages, PWA with offline shell, IndexedDB storage, light/dark/high contrast.
- AK820 writes are experimental (per-session opt-in) until verified on hardware.

### Platform

- `vercel.json` with strict CSP and Permissions-Policy `hid=(self)`; deployed and verified live.
- CI: lint, typecheck, tests, build, browser smoke test.

## 0.1.0 — 2026-10-07 — OpenAK820

Initial AK820 configurator: descriptor-based detection, five protocol families, firmware simulators,
CLI, web app, hardware-verified START handshake and per-key colour read on the AK820 MAX PLUS.
