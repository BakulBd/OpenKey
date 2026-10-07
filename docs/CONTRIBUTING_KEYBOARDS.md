# Adding a keyboard to OpenKey

Every keyboard goes through the same pipeline. You can stop at any step: each one is useful on its own.

```
unknown device → safe inspection → diagnostic package → GitHub issue → protocol research
   → adapter → fixtures → mock tests → real-hardware verification → experimental → verified
```

## 1. Inspect (anyone, no risk)

Open OpenKey in Chrome or Edge, choose **Inspect any HID device**, and pick the keyboard. OpenKey reads the
HID descriptors the browser exposes and sends **nothing** to the device. You will see its interfaces,
collections, report IDs and sizes, and any protocol families whose descriptor signature it resembles.

On Linux you can also run `pnpm inspect` (no device access needed) for USB-level details the browser
hides (interface numbers, endpoints, bInterval, bcdDevice).

## 2. Export and report

Click **Export diagnostic package**, review the JSON, then **Request device support**. The issue form opens
with a summary; attach the JSON. The package contains descriptors and app details only — no typing, no
serial number, no keymaps or macros.

Please add: the model name printed on the box, the firmware version if the vendor software shows it, and
how it was connected (cable, receiver, Bluetooth).

## 3. Contribution types

| Contribution      | What it is                                                               | Where                                                      |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Device definition | Identity, protocol family, per-transport configuration support, evidence | `devices/<id>.json` (schema: `devices/device.schema.json`) |
| Layout            | Key geometry, firmware slot, LED index, HID usage per key                | `packages/devices/src/layouts/<id>.json`                   |
| Catalogue entry   | Identity + OpenKey verification state                                    | `packages/devices/src/catalog.ts`                          |
| Protocol fixture  | A captured exchange with its expected decoding                           | `fixtures/<area>/<name>.json`                              |
| Adapter           | Protocol family implementation                                           | `packages/protocols/src/families/<family>/`                |
| Translation       | Strings for one language                                                 | `apps/web/src/i18n/locales/<code>.ts`                      |
| Documentation     | Evidence, research notes                                                 | `docs/`                                                    |

## 4. Same protocol as an existing family?

If the descriptors match an existing adapter **and** its read-only probe passes on your keyboard, a
device definition and a layout are usually enough. The adapter decides; the definition only names the
model and its layout. Do not assume two keyboards share a protocol because they share a VID:PID or look
alike — several AK820 variants do not.

A new layout stays read-only for keymap writes until each key's slot has been confirmed against the
board (Sharkfin's lesson: two boards can share a picture and disagree about slots).

## 5. A new protocol family

1. Capture the official software (see [reverse-engineering/capture-methodology.md](reverse-engineering/capture-methodology.md)):
   one change per capture, before/after state.
2. Write the protocol notes with evidence for every byte (VERIFIED / OBSERVED / INFERRED / HYPOTHESIS) in
   `docs/protocol/<family>.md`, and add the facts to [PROTOCOL_SOURCES.md](PROTOCOL_SOURCES.md).
3. Add fixtures for each verified exchange.
4. Implement the family: `match()` (descriptors only), `probe()` (one documented read-only command, or
   none), a driver extending `BaseKeyboardDriver`, `capabilities.ts` with a safety level per write, a
   firmware simulator, and a `manifest` with status `research` or `community`.
5. Tests: codecs against fixtures, detection, simulator integration, and fault injection with
   `MockHidDevice.inject()` (timeout, corrupt answer, disconnect, reset).
6. Real-hardware verification, one operation at a time, with read-back where possible. Record the result
   in [HARDWARE_TEST_MATRIX.md](HARDWARE_TEST_MATRIX.md). Only then may a capability's evidence become
   VERIFIED and its writes leave experimental mode.

## Rules

- No guessed packets, no fuzzing, no "try every report ID".
- Never send erase, boot-loader, OTA or calibration commands; firmware flashing is out of scope.
- Reverse-engineering facts may be learned from GPL projects, but code is never copied into OpenKey (MIT).
  See [LICENSE_NOTES.md](LICENSE_NOTES.md).
- Never commit vendor binaries, installers or firmware dumps.
