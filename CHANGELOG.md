# Changelog

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
