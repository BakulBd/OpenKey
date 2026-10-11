# Changelog

## Unreleased — AK820 verified, AULA and RK keyboards, easier Linux, GIF gallery

- AJAZZ AK820 MAX / MAX PLUS (`0C45:8009`, USB): keymap, Fn layer, macros, lighting, per-key colours,
  screen image and GIF, clock and settings writes are now **verified on hardware** (owner test,
  `fixtures/verification/ak820-max-plus-owner-test-hw.json`) and no longer need the experimental switch.
  Other AK820 variants and links keep their previous status. Write policy: a hardware-verified write of
  any assessed risk class is offered after a confirmation (every time for HIGH_RISK).
- New **BY Tech** adapter for AULA F75/F87/F99/H108 and RK R75 RGB: identifies the model by its own model
  code (one read, asked first except on `258A:010C`), reads the 128-byte settings page and writes back only
  changed bytes with a read-back check. Lighting and sleep are experimental. Unknown models (the R75) can
  be **taught** their layout from two key presses on the keyboard itself, reads only.
- Demo picker: AJAZZ AK820 MAX (screen), AULA F75 and RK R75 simulators.
- Linux: the rule is now `70-openkey.rules` (systemd applies `uaccess` only to rules sorted before
  `73-seat-late.rules`; the old `99-` name granted only the `plugdev` group) and the installer replaces
  OpenKey's old file. New `--device VVVV:PPPP` adds any keyboard. The setup panel gives one command to
  paste, prefilled with the failing keyboard's ID, and the app checks whether the OS lets it open the
  keyboard before asking for identification.
- Screen gallery: two original pixel-art cats (Kitty, Cat walk) and a new tab of nine public-domain /
  CC0 GIFs from Wikimedia Commons (cats, heart, Muybridge animals, Earth, globe, Newton's cradle,
  zoetrope), credited in THIRD_PARTY.md.
- Repository: https://github.com/BakulBd/openkey.
- **VIA adapter** for QMK/VIA and Vial keyboards: keymaps on any number of layers (layer and special
  keys in the picker), macros, QMK lighting channels, read-back after every write; VIA definition and
  QMK `info.json` import (KLE parser) or a matrix grid; reset and bootloader commands never sent.
- **Name Studio** on the Screen page: type a name ("Bakul" by default) and pick one of ten animated
  styles (Neon Pulse, Rainbow Wave, Galaxy Dream, Typewriter, Blaze, LED Marquee, Love Beat, Cyber
  Glitch, Royal Gold, Matrix Code), with a list of keyboards whose screen accepts uploads.
- SEO and sharing: descriptive title, canonical URL, Open Graph and Twitter cards with a 1200×630 image,
  JSON-LD, robots.txt and sitemap.xml (`OPENKEY_SITE_URL` sets the public URL), crawlable static text.
- **ROYUAN adapter** (sharkfin's hardware-tested notes, facts only): identify `0x8F`, command-set
  detection via `0x80`, lighting read/write `0x87`/`0x07` with read-back; reset, erase and boot opcodes
  refused by the packet builder. The magnetic AJAZZ AK820 (`3151:4015`) and the AJAZZ "BY edition"
  (`258A:010C`, BY Tech adapter) are now community-supported.
- **Classic RK adapter** (rangoli / kludgeknight facts): 78 Royal Kludge models from RK's own model list
  (RK61, RK68, RK84, RK87, RK100 …), lighting and sleep; write-only, identified from the vendor model list
  (`identifiedBy: 'vendor-model-list'`, documented in the adapter contract), nothing sent while detecting.
- **"Is my keyboard supported?"** guide for 40 popular keyboards by name (Bangladesh, Asia, gaming,
  enthusiast) in the Compatibility page and docs/MODEL_GUIDE.md.
- Screen: eight new animations (Fireworks, Snowfall, Ocean Sunset, Sakura, Bangladesh Flag, Fish Tank,
  Lava Lamp, Spiral Galaxy), two more public-domain GIFs (tesseract, hurricane from space), speed and loop
  (reverse, boomerang) controls, and photo slideshows with crossfades.
- Card-based Compatibility center (status cards as filters, brand chips, device cards, "not compatible
  yet" with reasons, VIA-for-any-brand callout), landing hero with a live keyboard screen, feature cards,
  per-page titles, and error boundaries so a failing page never blanks the app.
- Source review of the community projects with licences and findings: docs/SOURCES_REVIEW.md.

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
