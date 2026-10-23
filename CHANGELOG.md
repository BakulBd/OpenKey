# Changelog

## Unreleased — Dynamic Lighting, Razer, Wooting, Logitech, SteelSeries, AULA F87S/F108 Pro, AJ179 and more

Twelve new protocol adapters, two new keyboard profiles and fixes for limitations found while
researching them. Every new write is experimental (simulator-tested, not yet run on hardware) and stays
behind the experimental opt-in. Sources and what was taken from each: docs/SOURCES_REVIEW.md
("Review of 2026-10-17").

- **HID LampArray (Windows Dynamic Lighting)**: any keyboard implementing the public standard. The
  lamp positions and the key under each lamp are read from the keyboard, so the per-key studio shows
  the real board; per-key and solid colours, and giving the lighting back. The HID layer now keeps
  nested collections (WebHID and the Linux descriptor parser), which the standard needs.
- **Razer** (52 keyboards from OpenRGB’s table: BlackWidow, Huntsman, Ornata, Cynosa, DeathStalker):
  stored effects (static, breathing, spectrum, wave, reactive, starlight), brightness read back,
  per-key colours on the LED matrix, firmware version.
- **Wooting** (One, Two, 60HE, 80HE, UwU RGB) through Wooting’s own RGB SDK protocol: per-key and solid
  colours, back to the profile lighting.
- **Logitech G915 / G915 TKL / G815** over HID++ 2.0: features found through the root feature (no
  hard-coded indices), name, battery, per-key and solid colours, back to the on-board profile.
- **SteelSeries Apex 5/7/9/Pro**: direct per-key colours for all three firmware generations (picked
  from the firmware version), back to the keyboard’s lighting.
- **EVision firmware boards** (Redragon K552/K556 and other Sonix boards): 18 named effects,
  brightness, speed, direction and per-key colours on a full-size map.
- **A4Tech Bloody B820R, HyperX Alloy Origins, Ducky One 2 RGB**: direct per-key and solid colours.
  Where no command gives the lighting back, OpenKey says to unplug instead of inventing one.
- **FL Esports MK870** (and the Pulsar PCMK TKL), from the official FL Esports driver, keyboard-colour
  (MIT) and the PCMK notes:
  - lighting with two colours, rainbow and eight directions;
  - per-key colours on the driver's own LED matrix;
  - the default layer's key map: keys, keys with up to two modifiers, nine media keys, disabled
    keys and restore defaults;
  - sleep time.
  - lighting read back from the keyboard when it answers the official lighting query, and checked
    after every change.

  Lighting now supports rotating and radial directions and a second colour.

- **Diagnostics:** packages now carry a descriptor fingerprint, a vendor-channel map, protocol-family
  hints, why each adapter matched or not, evidence per feature, and the answer shapes of read-only
  protocol checks. They still carry no payloads or serial numbers. Device Lab → Report runs the
  MK870's check, and the demo has an MK870.
- **RK R75 RGB**: its own 80-key keyboard and knob, and its own effect list with the controls RK's
  configuration gives each, instead of a generic picture and 20 unnamed effects.
- **AJAZZ AK820 wired RGB (Moon switches)**, identified as `320F:505B` from the official AJAZZ
  driver's firmware updater. It runs on the EVision firmware: 18 effects, brightness, speed and
  per-key colours on its own 82-key map with the knob. Before this it fell back to the full-size
  map, where Enter, right Shift, Fn and the arrows got the wrong colours.
- **AULA NOVA75**, from the official driver's configuration files.
  - **Cable:** identified automatically, with the 80-key layout and knob, the 240 × 135 screen
    (107 frames at most) and lighting levels 0–6.
  - **Receiver:** the NOVA75's name, layout and lighting levels, plus battery, sleep, key response
    and game mode.
  - On macOS, where the browser may not see the receiver's configuration channel, detection and
    the Connection doctor say so and give the fix.
  - The 240 × 135 screen choice for unrecognised boards now stops at 107 frames.
- **AULA F87S 8K** (cable and receiver) and **AJAZZ AK680 V2 / AK680 MAX** (AULA/AJAZZ web-driver
  protocol): firmware, battery, effect, colour, brightness and speed read and read back; per-key
  colours on the F87S with the whole 128-slot table kept; through the receiver, nothing is changed
  unless it relays an F87S.
- **AJAZZ AJ179 mouse**: polling rate, DPI levels, lift-off, Motion Sync, Angle Snap, sleep, wake,
  debounce (0–20 ms) and lighting, all read back; works through the receiver (asleep mice explained).
- **AJAZZ AK992** (SEMICO firmware): effects, brightness and speed, at most one change a second; the
  firmware-update command is refused.
- **AULA F108 Pro** on the verified AJAZZ protocol: 104-key layout and the 240 × 135 screen, capped at
  the vendor’s 141 frames (more overwrites the keyboard’s own screens).
- **Screen size choice** (fix): an unrecognised keyboard on the AJAZZ protocol (AK35i V3 MAX “USB
  KEYBOARD”, AKS075 …) used to get the AK820 MAX’s 128 × 128 geometry. It now has to choose its
  screen size in the screen studio before any upload.
- **RK M87**: identified as a BY Tech board by its model code; sets the screen clock (the keyboard has
  no clock of its own). RK model codes are trusted only on their published USB IDs.
- **Mouse settings page** now renders from each mouse’s own schema (rates, DPI range, sleep options,
  toggles), so the AJ139 and AJ179 share it.
- **Connection doctor**: names the vendor app that holds a keyboard (Synapse, G HUB, SteelSeries GG,
  Wootility …); recognises LampArray and Razer’s control interface.
- Catalogue, model guide, research inventory and udev rules cover every new identity; licence facts
  corrected (dantje/ajazz-ak35i-v3-max is MIT, AuRoN89’s F108 work is CC-BY-4.0).
- Demo: AJAZZ AJ179 mouse and a Dynamic Lighting keyboard.
- Researched, not implemented, with the reason recorded: Corsair (software lighting needs a
  keep-alive), RK M75 live colour streaming, RK M87 picture upload, AULA receiver writes (sources
  disagree), AJAZZ AK33 (identity unknown).

## Unreleased — ZMK Studio, libhmk, Vial extras, VIA menus and knobs, wireless-aware guidance

- **ZMK Studio** (ZMK firmware over USB serial, Chrome/Edge): reads the keyboard's physical layout and
  keymap and writes changed keys, then saves them and reads them back. It waits for the board's own
  Studio unlock key and never unlocks the board itself. Behaviours OpenKey does not model are kept as
  they are; Bootloader, Reset and Soft Off are never assigned. The protobuf codec was checked against
  protobufjs and the official `.proto` files. A ZMK split demo is included. The Permissions-Policy now
  allows `serial` for OpenKey's own origin only.
- **libhmk** (Hall-effect keyboards): new adapter with keymaps on every layer and per-key actuation
  point and Rapid Trigger (press and release sensitivity, continuous mode). The layout is read from
  the keyboard's gzip metadata. A new **Actuation** page and a magnetic demo are added. Reboot,
  bootloader, reset and calibration commands are refused.
- **Vial extras**: a new Vial page for QMK settings, tap dance, combos and key overrides, read back
  after every write. Tap dances appear in the key picker. The Vial demo has a knob and a menu.
- **VIA**:
  - Knobs (↺ / press / ↻ on every layer).
  - Layout options stored in the keyboard are applied.
  - New **Keyboard menus** page for the definition's own controls (sliders, dropdowns, toggles,
    colours, buttons). Conditions are evaluated by a small parser, never `eval`.
  - **Fix:** VIA source definitions put the layout option on line 4 and the encoder on line 10
    (alignment 0); OpenKey read the option from line 9, so it missed every option in real VIA
    files. Parses now match VIA's compiled output exactly (checked on the GMMK Pro and the Keychron
    Q2 knob).
- **Wireless and limited access**:
  - On a 2.4 GHz receiver or Bluetooth, the overview and every device page say what the link allows
    (read-only, or some settings) and that the cable is needed for the rest.
  - Timeouts and transport errors on those links are explained as "asleep, out of range or not
    paired" with "press a key to wake it".
  - Read-only keyboards and writes waiting for the experimental switch get their own notice.
  - On Linux, read-only hidraw access is told apart from no access.
- **Teach → model profile**: a learned BY Tech layout can be saved as a small JSON file and sent with
  a device-support request, so a new model can be added as data.
- CLI (hidapi/hidraw): numbered input reports no longer carry their report-ID byte, which matches
  WebHID; the AULA receiver depends on this.
- CI runs the browser smoke test on Windows and macOS as well as Linux. OS-specific guidance (udev,
  vendor apps) is emulated, so it is tested the same everywhere.
- Keycode search knows everyday words: escape, windows, command, return, print screen …
- Model guide: ZMK, libhmk and Vial boards added; docs regenerated.
- **AJAZZ AJ139 V2 MC mouse**: new adapter and **Mouse settings** page.
  - Covers debounce (1–20 ms), polling rate (125–2000 Hz), six DPI levels and the active one, sleep,
    wake-up and scroll direction, plus a battery read. Works over the cable (`A8A4:2255`) and the
    receiver (`A8A5:2255`).
  - Settings are written as a read-modify-write of the block just read, checked against the mouse's
    reply and a fresh read, so fields OpenKey does not know are kept.
  - Built from Ripariav/Ajazz-AJ139V2MC-Linux-Driver (MIT). Includes a mouse demo and udev rules for
    both IDs.
  - The AJ179 (another AJAZZ mouse protocol) is listed for later.
- **AULA NOVA75** (user report, with the F75 Max sources it pointed to). `05AC:024F` is a receiver
  identity several brands share:
  - Receivers are named by product string.
  - The AJAZZ receiver ping is automatic only for AJAZZ names; an AULA receiver is asked first.
  - On macOS, the Connection doctor explains a receiver that shows only typing and media keys (its
    configuration channel may be hidden until the browser is allowed under Input Monitoring).
  - The F75 Max cable (`0C45:800A`) and receiver protocols were checked against OpenKey's AJAZZ
    adapters, and the receiver lighting packet is byte-identical. The NOVA75 is not assumed to be an
    F75 Max: the keyboard's own answer decides.

## Unreleased — Connection doctor, Vial, 2,000+ VIA boards, AK820 Pro screen, gallery v2

- **Connection doctor** (Tools → Connection doctor, and `openkey doctor` in the CLI) explains why a
  keyboard does not connect and gives the fix. It checks:
  - the browser (Firefox/Safari, phones, insecure pages, embedded frames);
  - Linux permissions (exact `--device` udev command), Windows/macOS vendor apps holding the device, and
    the macOS accessory prompt;
  - typing-only grants, 2.4 GHz/Bluetooth links, and USB identities shared by several models.

  Checking opens and closes the keyboard and sends nothing. The checks are shared pure functions in
  `packages/core/src/doctor.ts`.

- The VIA identification query now waits for consent on identities the catalogue assigns to vendor
  firmware: the AK820 receiver reuses VIA's FF60:61 page, and a QMK-flashed board keeps its USB ID.
- **One model, many chips**: guide entries list every hardware revision (chip, USB IDs, status, how to
  tell it apart). Detection still asks the keyboard, and the sidebar names the chip of the connected
  revision. Tests check revisions against the catalogue and resolve the AK820 MAX Plus revisions through
  their simulators.
- **Research inventory** (`docs/RESEARCH_INVENTORY.md`, generated with `pnpm docs:guide`): every model of
  the owner's list with revisions, open-source sources and licences (facts only), and what is needed to
  verify it. The AKS068 (VIA), AK680, AK992, AK870/873/966, AK35i V3 MAX, AK33, AULA F87, F108 Pro, F65,
  L99/S75, RK R65, M87/S98 and Akko 5075S are added to the model guide.
- **VIA index**: 2,021 VIA boards by USB ID and name (`pnpm via-index`, facts only from
  the-via/keyboards). The model finder searches them by name, maker or ID, and the doctor names them.
- VIA **layout options** (ISO Enter, split keys, bottom rows …) can be chosen when loading a definition.
  Compiled usevia.app definitions now include their option keys; before, boards such as the GMMK Pro
  lost Enter and left Shift.
- **Vial**: the layout is read from the keyboard itself, using Vial's three read-only commands and a new
  dependency-free XZ/LZMA2 decoder. Other Vial commands are refused. New Vial demo board.
- **AK820 Pro screen framing**: still images use the Pro framing two community tools report working on
  Pro hardware (OBSERVED), and animations use sub-command 03 (INFERRED). Both stay behind the
  experimental opt-in; the verified AK820 MAX path is unchanged.
- **Screen gallery v2**:
  - categories, search and favourites (kept in this browser), plus "fits this screen / trimmed to N
    frames" for the connected screen;
  - seven new animations: Eid crescent, Alpona, Synthwave, Rainy window, Floating hearts, Comet ring,
    Pixel ghost;
  - a test checks every bundled GIF's licence, credit and frame budget.
- Footer **contributor wall** (inspired by gucc.green.edu.bd): GitHub contributors with self-hosted
  avatars (`pnpm contributors`) and a "Become a contributor" link; no request reaches GitHub.
- Free Vercel (Hobby) plan: a test keeps the deployment static (no functions, middleware or crons) and
  the bundled media small.
- CLI: `list` finds every catalogued vendor and any VIA board, not only AK820 vendor IDs.

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
- **VIA layouts from usevia.app**: one click downloads a VIA keyboard's published definition (about
  2,000 boards; compiled v2/v3 format parsed), so Keychron, GMMK, IDOBAO, KBDfans, MelGeek and other
  VIA keyboards need no file. Opt-in only; documented in PRIVACY.md; `connect-src` allows usevia.app.
- Model guide: Lingbao MK75, AULA F75 Max / F2088, AJAZZ AKS075, RK M75, more Fantech models and the VIA
  catalogue families; AK820 Pro still-image framing difference recorded (Beattrey) with a warning.
- **AULA F99 family** (docs/AULA_F99.md): F99, F99 Pro and F99 Wired identified by model code over
  the cable; new read-only **AULA receiver** adapter (`3554:FA09`: model, firmware/battery, lighting
  page; write, apply and reset opcodes refused). The F99 Max is not assumed compatible.
- **ROYUAN key maps**: read on yc500 and gen2 boards (slots labelled by the base layer), written key by
  key with read-back on yc500; firmware that drops single-key writes is reported, not assumed.
- Codebase: Prettier across the repository with a CI check; issue forms, PR template, CODEOWNERS,
  Dependabot, code of conduct; switch-style toggles and collapsed source notes on device settings.
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
