# Architecture audit (Phase 0)

Audit of the OpenAK820 repository on 2026-10-08, before the OpenKey migration. It records what existed,
what worked, what was broken and what the migration changes. Later phases are tracked in
[ROADMAP.md](ROADMAP.md).

## 1. Repository inventory

| Area                  | Path                                    | State at audit                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport abstraction | `packages/hid`                          | `HidTransport` interface, WebHID backend, descriptor parser, `MockHidTransport`, replay transport, packet logging. No platform API leaks into protocol code (ESLint-enforced).                                                                                                                        |
| Linux transport       | `packages/hid-node`                     | sysfs enumeration + hidraw via node-hid. CLI only, never in the web build.                                                                                                                                                                                                                            |
| Core model            | `packages/core`                         | `KeyboardDriver` interface, `BaseKeyboardDriver` (every method throws `UnsupportedFeatureError`), capability model with 7 statuses, `Confidence` (4 levels), backup format v1, `StateStore` for write-only firmware, error explanations.                                                              |
| Protocols             | `packages/protocols`                    | `ProtocolRegistry`: descriptor `match` → read-only `probe` → select; refuses to choose between equal candidates. Families: `sonix-feature` (flagship), `sonix-aa55`, `sonix-dongle`, `qmk-via`, `crs-aa55cc33`. Each has constants with evidence, and the two main families have firmware simulators. |
| Device definitions    | `profiles/*.json` + `packages/profiles` | Declarative JSON with schema, per-transport configuration status with evidence, layouts (x/y/w/h, slot, LED index, HID usage). The directory name collides with user "profiles" (Coding/Gaming…).                                                                                                     |
| TFT processing        | `packages/tft`                          | RGB565, fit/fill, dithering, GIF decoding, test patterns. Pure TypeScript.                                                                                                                                                                                                                            |
| Web app               | `apps/web`                              | Vite + React 19 SPA, hash routing, capability-gated navigation, simulated keyboard, pages for keymap/Fn/RGB/per-key/macros/TFT/profiles/device/diagnostics/backup.                                                                                                                                    |
| CLI and RE tools      | `tools/*`                               | `openak820` CLI (detect, polling, read/write), device inspector, probe, packet diff, usbmon capture.                                                                                                                                                                                                  |
| RE evidence           | `re/`                                   | USB descriptor dump, HID report descriptors for interfaces 2/3, three passive feature reads, HID captures, `read_feature.c`. Preserved unchanged.                                                                                                                                                     |
| Fixtures              | `fixtures/`                             | 8 fixtures; two are real hardware captures (START handshake, per-key colour read).                                                                                                                                                                                                                    |
| Docs                  | `docs/`                                 | Protocol specs, research log, public research comparison (18 projects), capture methodology, official-driver analysis, compatibility, safety policy.                                                                                                                                                  |
| Tests                 | `tests/`                                | 79 tests, all passing: codecs, detection, simulator integration, hardware replay, descriptor parsing, TFT.                                                                                                                                                                                            |
| CI                    | `.github/workflows/ci.yml`              | typecheck, lint, test, build.                                                                                                                                                                                                                                                                         |

## 2. Health at audit

| Check            | Result                                                      |
| ---------------- | ----------------------------------------------------------- |
| `pnpm lint`      | pass                                                        |
| `pnpm test`      | pass (79 tests)                                             |
| `pnpm typecheck` | **fail**: `apps/web` used a removed `osKeyLocks` capability |
| `pnpm build`     | **fail** (same cause)                                       |
| Git history      | none: the repository had no commits                         |

Both failures were fixed in the second commit; the baseline was committed first so nothing could be lost.

## 3. Feature inventory (AK820 MAX PLUS, `sonix-feature`)

Evidence status uses the vocabulary of [PROTOCOL_SOURCES.md](PROTOCOL_SOURCES.md).

| Feature                            | Implemented | Evidence                                                       | Hardware state                  |
| ---------------------------------- | ----------- | -------------------------------------------------------------- | ------------------------------- |
| Descriptor detection               | yes         | descriptors of the test unit                                   | VERIFIED                        |
| START handshake `04 18`            | yes         | hardware fixture                                               | VERIFIED                        |
| Per-key colour read `04 F5`        | yes         | hardware fixture                                               | VERIFIED                        |
| Keymap / Fn layer write            | yes         | official driver code path, byte-for-byte                       | OBSERVED, NOT_TESTED            |
| Lighting effects write             | yes         | official driver                                                | OBSERVED, NOT_TESTED            |
| Per-key colour write               | yes         | official driver                                                | OBSERVED, NOT_TESTED            |
| Macros write                       | yes         | official driver; trigger-mode bytes from the online driver     | OBSERVED / INFERRED, NOT_TESTED |
| TFT image/GIF upload               | yes         | official driver                                                | OBSERVED, NOT_TESTED            |
| TFT clock                          | yes         | official driver                                                | OBSERVED, NOT_TESTED            |
| Sleep, key response, Win/Alt locks | yes         | official driver                                                | OBSERVED, NOT_TESTED            |
| Keymap/lighting read-back          | no          | firmware has no read command in the official driver            | firmware-limited (mirror only)  |
| Battery                            | no over USB | official driver reads it only via the 2.4 GHz receiver         | NOT_SUPPORTED over USB          |
| Polling-rate setting               | no          | no command in the official driver                              | NOT_SUPPORTED                   |
| Knob remapping                     | no          | no command in the official driver; knob sends Consumer Control | PHYSICALLY_PRESENT              |

**Finding:** the web app enabled every OBSERVED write by default. The OpenKey safety policy requires
writes that were never verified on hardware to be opt-in and labelled experimental. Phase 2 changes this.

**Finding:** the polling-rate capability displayed "1000 Hz ceiling (bInterval 1 ms)". bInterval is a
declared interval, not a measured rate. Phase 2 rewords it as "declared interval 1 ms; cadence not measured".

## 4. Protocol evidence inventory

| Family          | Devices                                                                | Evidence                                                            | OpenKey status                                |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `sonix-feature` | AK820 MAX / MAX PLUS, AK820 (Windows-driver firmware) `0C45:8009/800A` | official Windows driver analysis, hardware handshake + per-key read | flagship; reads verified, writes experimental |
| `sonix-aa55`    | AK820 Pro (online driver), AK820 MAX HE `0C45:80B1`                    | official online driver, community projects                          | simulator-tested only                         |
| `sonix-dongle`  | 2.4 GHz receivers `0C45:FDFD`, `05AC:024F`                             | official driver                                                     | detection + ping, untested                    |
| `crs-aa55cc33`  | CRS-MCU "AK820 Max Plus" `1A2C:8FFF/A036`                              | community projects                                                  | identification only                           |
| `qmk-via`       | community QMK builds                                                   | VIA protocol                                                        | identification only                           |
| SinoWealth      | "AK820 MAX" `258A:010C`                                                | community project                                                   | catalogue entry only                          |

The `258A:010C` identity is also the wired AULA F75 (see [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md)). Two
different products share one VID:PID; this is the concrete case for never selecting a protocol by
VID:PID.

## 5. Deployment audit

| Requirement          | At audit                                                | Action                                                                                 |
| -------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Static output        | yes (`vite build` → `apps/web/dist`, relative `base`)   | keep Vite; Next.js adds nothing for a static SPA                                       |
| No server dependency | yes                                                     | keep                                                                                   |
| Vercel config        | none                                                    | add `vercel.json` (build command, output dir, headers)                                 |
| Routes on refresh    | hash routing, always works                              | keep hash routing                                                                      |
| Security headers     | none                                                    | add CSP, Permissions-Policy (`hid=(self)`), nosniff, Referrer-Policy, frame protection |
| PWA                  | none                                                    | add manifest, icons, service worker, update prompt                                     |
| Bundle               | one 384 kB chunk (118 kB gzip), TFT and protocols eager | lazy-load pages, TFT and research tools                                                |
| Telemetry            | none                                                    | keep none                                                                              |
| Local state          | `localStorage`                                          | move substantial state to IndexedDB                                                    |

## 6. Gaps against the OpenKey brief

Present and kept: transport layer, descriptor detection, read-only probes, adapter registry, capability
statuses, declarative device definitions, layouts, mock HID, simulators, backup, evidence docs.

Missing: OpenKey identity; explicit connection state machine; device fingerprint with explainable
detection confidence; adapter manifests (version, verification, safety, provenance, planned adapters);
operation safety levels; transaction model with read-back verification; undo/redo; IndexedDB storage;
unknown-device mode with diagnostic export; support bundle; research lab / protocol trace / latency lab;
keyboard tester; command palette; i18n; PWA; security headers; landing page; compatibility center; most
of the required documentation.

## 7. Architecture proposal

Keep the package structure; it already separates transport, protocol and UI. Rename to OpenKey and add
the missing layers as framework-independent modules in `packages/core`:

```
apps/web (React UI, i18n, PWA)                 tools/cli (Node)
        │                                            │
        ├── features: keymap, rgb, macros, tft, tester, lab, backup, compat
        │
@openkey/protocols   AdapterRegistry = ProtocolRegistry + AdapterManifest
        │            detect → fingerprint → match → probe → select
        │            adapters: sonix-feature, sonix-aa55, sonix-dongle, qmk-via, crs
        │            planned:  aula-sinowealth, royuan, vial (manifest + descriptor signature only)
@openkey/core        capabilities · safety · transaction · history · connection state machine
                     fingerprint · backup · support bundle · latency statistics · errors
@openkey/hid         HidTransport · WebHID · MockHidTransport (fault injection) · replay
@openkey/devices     declarative device definitions + layouts (was profiles/)
@openkey/tft         image pipeline (lazy-loaded)
```

## 8. Migration plan

1. Rename packages and user-facing strings to OpenKey; `profiles/` → `devices/`.
2. Core foundation: evidence vocabulary, capability states, safety levels, transaction, history, state
   machine, fingerprint, support bundle, latency statistics; MockHid fault injection. Tests for each.
3. Adapter manifests in the registry; planned AULA/ROYUAN/Vial manifests with descriptor signatures and no
   I/O; AK820 safety policy (OBSERVED writes are experimental, opt-in).
4. Web UI: landing page, demo, state machine, unknown-device mode, keymap studio with staged changes and
   undo, research lab, tester, latency lab, compatibility center, command palette, IndexedDB.
5. Platform: i18n (11 languages), PWA, security headers, lazy loading.
6. Documentation set, CI, Vercel preview deployment and header verification.
