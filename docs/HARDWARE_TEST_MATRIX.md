# Hardware test matrix

What has been run on physical keyboards. Simulator and mock tests are **not** hardware tests and are not
counted here.

Statuses: **VERIFIED** (run on hardware, result observed, read back where possible) · **PASS** (run on
hardware, expected result, no independent read-back) · **FAIL** · **NOT_TESTED** · **NOT_SUPPORTED** ·
**UNKNOWN** · **EXPERIMENTAL** (implemented, waiting for a hardware run).

## AJAZZ AK820 MAX PLUS (TFT) — `0C45:8009`, "AK820 MAX", fw 1.07 (bcdDevice)

Tester: project owner. Host: Linux (hidraw via the CLI). Browser runs with real hardware: not yet.

| Feature                    | USB                                           | 2.4 GHz       | Bluetooth     | Notes                                             |
| -------------------------- | --------------------------------------------- | ------------- | ------------- | ------------------------------------------------- |
| Descriptor detection       | VERIFIED                                      | NOT_TESTED    | NOT_TESTED    | `openak820 detect --verbose`                      |
| Protocol handshake (START) | VERIFIED                                      | NOT_TESTED    | NOT_SUPPORTED | fixture `ak820-max-plus-start-handshake-hw.json`  |
| Keymap (base)              | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED | write-only firmware; cannot be read back          |
| Fn layer                   | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED | write-only                                        |
| Macros                     | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED | trigger-mode bytes INFERRED                       |
| Lighting effects           | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED | write-only                                        |
| Per-key colour read        | VERIFIED                                      | NOT_TESTED    | NOT_SUPPORTED | fixture `ak820-max-plus-read-per-key-hw.json`     |
| Per-key colour write       | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED | can be verified by read-back once run             |
| TFT image / GIF            | EXPERIMENTAL                                  | NOT_SUPPORTED | NOT_SUPPORTED | official menu: no screen upload over 2.4 GHz      |
| TFT clock                  | EXPERIMENTAL                                  | NOT_TESTED    | NOT_SUPPORTED |                                                   |
| Profiles (on-board)        | UNKNOWN                                       | UNKNOWN       | UNKNOWN       | no evidence either way                            |
| Battery                    | NOT_SUPPORTED                                 | NOT_TESTED    | UNKNOWN       | readable only via receiver (official driver)      |
| Polling / latency          | declared 1 ms (bInterval); cadence NOT_TESTED | NOT_TESTED    | NOT_TESTED    | measure with the Latency lab or `openkey polling` |

## Browser × OS

| Browser                          | OS                       | WebHID                         | App shell                         | Demo       | Real keyboard |
| -------------------------------- | ------------------------ | ------------------------------ | --------------------------------- | ---------- | ------------- |
| Chrome 154 (headless, automated) | Linux                    | available                      | PASS                              | PASS       | NOT_TESTED    |
| Chrome, Edge (desktop)           | Windows, macOS, ChromeOS | expected available             | NOT_TESTED                        | NOT_TESTED | NOT_TESTED    |
| Firefox, Safari                  | any                      | not implemented by the browser | NOT_TESTED (no WebHID dependency) | NOT_TESTED | NOT_SUPPORTED |
| Any browser                      | Android, iOS             | not available                  | NOT_TESTED                        | NOT_TESTED | NOT_SUPPORTED |

Automated browser runs: `tools/e2e/smoke.mjs` (CI and against the live deployment).

## Other devices

No other keyboard has been run by OpenKey. Every other catalogue entry is community, research or
unsupported — see the Compatibility page.

## Next hardware runs (need the owner's consent; one at a time, backup first)

1. Real keyboard in the deployed web app over WebHID: connect, detection, per-key read.
2. Per-key write + read-back (verifiable): first candidate to become VERIFIED.
3. Lighting effect → clock → settings → keymap → macros → TFT upload (each changes state the firmware
   cannot report; record what is visible on the keyboard).
4. 2.4 GHz receiver: detection and battery.
5. Latency lab: vendor input reports and key-event cadence.
