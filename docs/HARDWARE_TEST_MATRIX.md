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
