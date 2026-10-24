# Hardware test matrix

What has been run on physical keyboards. Simulator and mock tests are **not** hardware tests and are not
counted here.

Statuses: **VERIFIED** (run on hardware, result observed, read back where possible) · **PASS** (run on
hardware, expected result, no independent read-back) · **FAIL** · **NOT_TESTED** · **NOT_SUPPORTED** ·
**UNKNOWN** · **EXPERIMENTAL** (implemented, waiting for a hardware run).

## AJAZZ AK820 MAX PLUS (TFT) — `0C45:8009`, "AK820 MAX", fw 1.07 (bcdDevice)

Tester: project owner. Host: Linux. Writes run from OpenKey with the experimental opt-in on 2026-10-11 and
confirmed by the owner on the keyboard (`fixtures/verification/ak820-max-plus-owner-test-hw.json`).

| Feature                                   | USB                                           | 2.4 GHz       | Bluetooth     | Notes                                             |
| ----------------------------------------- | --------------------------------------------- | ------------- | ------------- | ------------------------------------------------- |
| Descriptor detection                      | VERIFIED                                      | NOT_TESTED    | NOT_TESTED    | `openak820 detect --verbose`                      |
| Protocol handshake (START)                | VERIFIED                                      | NOT_TESTED    | NOT_SUPPORTED | fixture `ak820-max-plus-start-handshake-hw.json`  |
| Keymap (base)                             | PASS (owner, 2026-10-11)                      | NOT_TESTED    | NOT_SUPPORTED | write-only firmware; cannot be read back          |
| Fn layer                                  | PASS (owner, 2026-10-11)                      | NOT_TESTED    | NOT_SUPPORTED | write-only                                        |
| Macros                                    | PASS (owner, 2026-10-11)                      | NOT_TESTED    | NOT_SUPPORTED | trigger-mode bytes INFERRED                       |
| Lighting effects                          | PASS (owner, 2026-10-11)                      | NOT_TESTED    | NOT_SUPPORTED | write-only                                        |
| Per-key colour read                       | VERIFIED                                      | NOT_TESTED    | NOT_SUPPORTED | fixture `ak820-max-plus-read-per-key-hw.json`     |
| Per-key colour write                      | VERIFIED (owner run + read-back)              | NOT_TESTED    | NOT_SUPPORTED | can be verified by read-back once run             |
| TFT image / GIF                           | PASS (owner, 2026-10-11)                      | NOT_SUPPORTED | NOT_SUPPORTED | official menu: no screen upload over 2.4 GHz      |
| TFT clock                                 | PASS (owner, 2026-10-11)                      | NOT_TESTED    | NOT_SUPPORTED |                                                   |
| Settings (sleep, debounce, Win/Alt locks) | PASS (owner, 2026-10-11)                      | NOT_TESTED    | NOT_SUPPORTED | write-only                                        |
| Live per-key preview                      | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED | not part of the owner test                        |
| Profiles (on-board)                       | UNKNOWN                                       | UNKNOWN       | UNKNOWN       | no evidence either way                            |
| Battery                                   | NOT_SUPPORTED                                 | NOT_TESTED    | UNKNOWN       | readable only via receiver (official driver)      |
| Polling / latency                         | declared 1 ms (bInterval); cadence NOT_TESTED | NOT_TESTED    | NOT_TESTED    | measure with the Latency lab or `openkey polling` |

## Browser × OS

| Browser                          | OS                       | WebHID                         | App shell                         | Demo       | Real keyboard |
| -------------------------------- | ------------------------ | ------------------------------ | --------------------------------- | ---------- | ------------- |
| Chrome 154 (headless, automated) | Linux                    | available                      | PASS                              | PASS       | NOT_TESTED    |
| Chrome, Edge (desktop)           | Windows, macOS, ChromeOS | expected available             | NOT_TESTED                        | NOT_TESTED | NOT_TESTED    |
| Firefox, Safari                  | any                      | not implemented by the browser | NOT_TESTED (no WebHID dependency) | NOT_TESTED | NOT_SUPPORTED |
| Any browser                      | Android, iOS             | not available                  | NOT_TESTED                        | NOT_TESTED | NOT_SUPPORTED |

Automated browser runs: `tools/e2e/smoke.mjs` (CI and against the live deployment).

## Other devices

PASS results become VERIFIED in the capability model because the owner observed each result on the
keyboard (the firmware cannot report these settings back). They apply to `0C45:8009` over USB only.

### RK R75 RGB — `258A:015E`, "BY Tech Gaming Keyboard"

Attached to the development machine on 2026-10-11. Only its report descriptors were read (sysfs); nothing
was sent to it. Descriptor: vendor collection `FF00:0001` with feature reports 5 (5 B) and 6 (519 B), the
BY Tech command channel. Identification, settings read and the layout-teaching flow wait for the owner
to run them in the browser.

| Feature                  | USB        | Notes                                                             |
| ------------------------ | ---------- | ----------------------------------------------------------------- |
| Descriptor detection     | VERIFIED   | BY Tech candidate; consent asked before the identity read         |
| Identity read (GET_INFO) | NOT_TESTED | expected model code `0a 00 00 00 00 00` (RK driver configuration) |
| Settings page read       | NOT_TESTED |                                                                   |
| Lighting writes          | NOT_TESTED | blocked until the layout is taught or confirmed                   |

Every other catalogue entry is community, research or unsupported — see the Compatibility page.

## Next hardware runs (need the owner's consent; one at a time, backup first)

1. RK R75 RGB: install the Linux rule (`sudo sh udev/install-openkey-udev.sh`), replug, connect in the
   browser, allow identification, then Lighting → Teach OpenKey (reads only).
2. AK820: live per-key preview; 2.4 GHz receiver detection and battery.
3. AULA F75/F99 owners: identification and lighting writes with read-back.
4. Latency lab: vendor input reports and key-event cadence.

## Adapters added on 2026-10-17 (no hardware run yet)

Every feature below is **EXPERIMENTAL**: implemented from the cited sources and tested against
simulators only. Writes stay behind the experimental opt-in until an owner test produces a `-hw.json`
fixture. Exception: on the **FL Esports MK870** an owner verified the lighting, per-key colours,
base-layer key map and macros
([`fixtures/verification/mk870-owner-test-issue13.json`](../fixtures/verification/mk870-owner-test-issue13.json));
its FN1 layer and sleep time are still experimental.

| Adapter                                       | Keyboards                                                             | Implemented                                                                                                              | Read-back                                            |
| --------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| hid-lamparray                                 | any HID LampArray (Windows Dynamic Lighting) keyboard                 | lamp layout read from the keyboard, per-key and solid colours, give back to the keyboard                                 | layout yes; colours no (standard has no colour read) |
| aj179-mouse                                   | AJAZZ AJ179 (cable, receiver)                                         | rate, DPI levels, lift-off, Motion Sync, Angle Snap, sleep, wake, debounce, lighting, battery; button mapping and macros | settings yes; buttons and macros no                  |
| semico-lighting                               | AJAZZ AK992 wired                                                     | effects, brightness, speed                                                                                               | no (write-only firmware)                             |
| hub-aa55                                      | AULA F87S 8K (cable, receiver), AJAZZ AK680 V2 / MAX                  | device info, battery, effect, colour, brightness, speed; per-key and knob-ring / side-light zones (F87S)                 | yes                                                  |
| sonix-feature (profiles)                      | AULA F108 Pro; AK35i V3 MAX and AKS075 via the screen-size choice     | everything the AK820 MAX path does, with each board's screen limits                                                      | as the AK820 MAX path                                |
| sonix-feature + sonix-dongle (NOVA75)         | AULA NOVA75 cable (0C45:800A) and receiver (05AC:024F)                | cable: as the AK820 MAX path, 107 frames; receiver: lighting, battery, sleep, response, game                             | cable: as the AK820 MAX path; receiver: battery only |
| by-tech (models)                              | RK M87 (screen clock), RK M75 (teach)                                 | screen clock; settings page                                                                                              | clock: no                                            |
| razer-chroma                                  | 52 Razer keyboards                                                    | effects, brightness, per-key matrix                                                                                      | brightness yes                                       |
| wooting-rgb                                   | Wooting One, Two, 60HE, 80HE, UwU RGB                                 | per-key, solid, give back to the profile                                                                                 | no                                                   |
| evision                                       | EVision firmware boards (Redragon …, AJAZZ AK820 wired RGB)           | 18 effects, brightness, speed, direction, per-key                                                                        | no                                                   |
| winbond-lighting                              | FL Esports MK870 (0416:C345), Pulsar PCMK TKL (0416:B23C)             | lighting, per-key, base and FN1 key maps (keys, combos, media, macros), macros, sleep, model check                       | no                                                   |
| rk-classic                                    | 78 Royal Kludge models on RK’s list (RK61, RK68, RK84, RK87, RK100 …) | lighting, sleep, key map and per-key colours on RK’s own key table                                                       | no                                                   |
| rk-m87-receiver                               | RK M87 2.4 GHz receiver (258A:0150)                                   | screen clock, link state                                                                                                 | link state yes                                       |
| bloody-b820r, hyperx-alloy-origins, ducky-rgb | A4Tech Bloody B820R, HyperX Alloy Origins, Ducky One 2 RGB            | direct per-key and solid colours                                                                                         | no                                                   |
| steelseries-apex                              | SteelSeries Apex 5/7/9/Pro                                            | direct per-key and solid colours, give back                                                                              | no                                                   |
| logitech-hidpp                                | Logitech G915, G915 TKL, G815 (cable, Lightspeed)                     | name, battery, per-key and solid colours, give back                                                                      | battery yes                                          |
