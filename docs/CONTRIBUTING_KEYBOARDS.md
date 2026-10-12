# Adding a keyboard to OpenKey

Every keyboard goes through the same pipeline. You can stop at any step: each one is useful on its own.

```
unknown device → safe inspection → sanitized diagnostics → contributor research → candidate adapter
   → fixture tests → experimental status → physical verification → verified release
```

Each step leaves something reviewable: a diagnostic file, an issue, a ledger entry, a fixture, a test,
an evidence record. Nothing in this pipeline requires changing the UI.

## 1. Inspect (anyone, no risk)

Open OpenKey in Chrome or Edge, choose **Inspect any HID device**, and pick the keyboard. OpenKey reads the
HID descriptors the browser exposes and sends **nothing** to the device. You will see its interfaces,
collections, report IDs and sizes, and any protocol families whose descriptor signature it resembles.

On Linux you can also run `pnpm inspect` (no device access needed) for USB-level details the browser
hides (interface numbers, endpoints, bInterval, bcdDevice).

OpenKey shows a **verdict** for every device (verified match, unverified firmware, strong candidate,
resembles a family, inspection only, unknown …) with the reasons, the conflicting evidence, what could
not be observed, and the next safe step. If your device is a _strong candidate_, OpenKey offers to run
one identification handshake and lists exactly what it sends; it never runs it without your click.

## 2. Export and report

Click **Export diagnostic package**, review the JSON, then **Request device support**. The issue form opens
with a summary; attach the JSON. The package contains descriptors and app details only — no typing, no
serial number, no keymaps or macros.

Please add: the model name printed on the box, the firmware version if the vendor software shows it, and
how it was connected (cable, receiver, Bluetooth).

Researchers can analyse any diagnostic file without the device: **Research lab → Offline analysis** in
the app, or `pnpm openkey analyze <file.json>`. Two unidentified keyboards are included as samples
(`fixtures/diagnostics/`).

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
4. Implement the family from the template in `packages/protocols/src/families/example/`, following
   [ADAPTER_GUIDE.md](ADAPTER_GUIDE.md): `match()` (descriptors only), a `probePlan` declaring every
   report the probe sends and when it may run without asking, `probe()` that sets `identified` only on
   a family-specific answer, a driver extending `BaseKeyboardDriver`, capabilities with a safety level
   per write, an evidence ledger, a firmware simulator, and a `manifest` with status `research` or
   `community`.
5. Tests: the conformance kit (`checkManifest`, `checkMatchPurity`, `checkProbeTraffic`), codecs against
   fixtures, detection, simulator integration, the ledger rules, and fault injection with
   `MockHidDevice.inject()` (timeout, corrupt answer, disconnect, reset). Fixtures A and B must still
   produce no selection.
6. Real-hardware verification, one operation at a time, with read-back where possible. Record the result
   in [HARDWARE_TEST_MATRIX.md](HARDWARE_TEST_MATRIX.md). Only then may a capability's evidence become
   VERIFIED and its writes leave experimental mode.

## Rules

- No guessed packets, no fuzzing, no "try every report ID".
- Never send erase, boot-loader, OTA or calibration commands; firmware flashing is out of scope.
- Reverse-engineering facts may be learned from GPL projects, but code is never copied into OpenKey (MIT).
  See [LICENSE_NOTES.md](LICENSE_NOTES.md).
- Never commit vendor binaries, installers or firmware dumps.
