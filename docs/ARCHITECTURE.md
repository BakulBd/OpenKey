# Architecture

OpenKey is a static web application plus a Node CLI over shared, framework-independent packages. The
browser talks to the keyboard directly; there is no OpenKey server.

```
Vercel (static files only)
   │  HTML, JS, CSS, service worker — no API, no database, no secrets
   ▼
Browser ── WebHID ──► keyboard
   │
   ├─ apps/web              React UI, i18n, PWA, IndexedDB
   │    state/keyboard.tsx  connection state machine · safety gate · transactions
   │    features/*          one lazy-loaded chunk per page
   │
   ├─ @openkey/protocols    AdapterRegistry (ProtocolRegistry)
   │    detect: descriptors → match → read-only probe → select → fingerprint
   │    adapters: sonix-feature · sonix-aa55 · sonix-dongle · qmk-via · crs-aa55cc33
   │    planned:  aula-sinowealth · royuan · vial   (descriptor signature only, no I/O)
   │
   ├─ @openkey/core         capability model · evidence · safety · transaction · history
   │                        connection state machine · backup v2 · diff · support bundle
   │                        cadence statistics · keycode catalogue · errors
   │
   ├─ @openkey/hid          HidTransport · WebHID backend · descriptor parser
   │                        MockHidTransport (fault injection) · replay · packet log
   ├─ @openkey/devices      declarative device definitions (devices/*.json) · layouts · catalogue
   └─ @openkey/tft          RGB565 · fit · rotate · dither · GIF decode (lazy-loaded)

tools/cli (Node) uses the same packages with @openkey/hid-node (Linux hidraw).
```

## Layers

| Layer                  | Where                                                       | Knows about                                                             |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Transport              | `packages/hid`                                              | reports, report IDs, interfaces. Nothing about RGB, keymaps or vendors. |
| Device discovery       | `WebHidBackend.request`, `groupHidDevices`                  | groups HID interfaces of one physical device                            |
| Protocol detection     | `ProtocolRegistry.detect`                                   | descriptor signatures, read-only probes                                 |
| Adapter registry       | `createDefaultRegistry()`                                   | adapters and planned adapters with manifests                            |
| Capability engine      | `core/model/capabilities.ts`                                | per-feature status, access, evidence, safety                            |
| Normalized model       | `core/driver.ts` (`KeyboardDriver`)                         | protocol-neutral keymap, lighting, macros, TFT …                        |
| Configuration services | `core/transaction.ts`, `core/backup*.ts`, `core/history.ts` | writes, read-back, diff, undo                                           |
| UI                     | `apps/web`                                                  | capabilities, never wire bytes                                          |

## Principles

- **Detection never trusts VID/PID alone.** Each adapter matches on collections (usage page, usage, report
  sizes) and confirms with a documented read-only probe. The catalogue only names devices, and refuses
  to name an identity that several products share (`258A:010C` is both an AULA F75 and an AJAZZ
  "BY edition").
- **Explainable detection.** `buildFingerprint()` records every signal and produces a confidence
  (UNKNOWN / LOW / MEDIUM / HIGH / VERIFIED) and the "Detected because…" text shown in the UI.
- **One evidence vocabulary.** VERIFIED, OBSERVED, INFERRED, HYPOTHESIS, UNKNOWN, NOT_TESTED — in code,
  fixtures and docs. Only hardware evidence yields VERIFIED (`statusFromSource`).
- **Capabilities are not booleans.** SUPPORTED, CONFIGURABLE, READ_ONLY, WRITE_ONLY, FIXED,
  PHYSICALLY_PRESENT, NOT_YET_REVERSE_ENGINEERED, NOT_SUPPORTED, TRANSPORT_LIMITED, FIRMWARE_LIMITED,
  UNVERIFIED, UNKNOWN. Navigation follows `navigationMode()`: show, research needed, or hide.
- **Safety per operation.** Each write carries a safety level. `writeDecision()` allows only verified
  writes of a safe class in normal use; unverified writes need a per-session opt-in that is never
  remembered; firmware-class operations do not exist in OpenKey.
- **Honest transactions.** `runTransaction()` validates, diffs, applies, records the acknowledgement,
  and reports VERIFIED only after reading the value back _from the device_. Mirrors of write-only
  firmware never count as verification ("write sent; verification unavailable").
- **Protocol code never touches a platform API.** ESLint forbids `navigator`, `node:*` and `node-hid` in
  `core`, `protocols` and `tft`.
- **Unknown devices are read-only.** Planned adapters have no probe and no driver; unknown-device mode
  sends nothing beyond the browser's own descriptor access.
- **Every magic number is a named constant with its evidence** (`families/*/constants.ts`).

## Connection state machine

`core/connection.ts`: DISCONNECTED → REQUESTING_PERMISSION → CONNECTING → INSPECTING → DETECTING →
READING → READY ⇄ APPLYING → VERIFYING, plus ERROR and DISCONNECTING. Unknown devices go from DETECTING
straight to READY in `unknown` mode, where APPLY is not a valid transition. Unplug (`LOST`) always lands in
DISCONNECTED; a reconnect starts from scratch and can never resume a write.

## Storage

IndexedDB (`apps/web/src/state/db.ts`): a `mirror` store (what OpenKey wrote to write-only firmware) and a
`records` store (profiles, backups, macro/TFT projects, traces). `localStorage` holds only preferences.
Export all / import / clear are in Settings. Nothing is uploaded.

## Performance

Measured on the production build: initial load ≈ 90 kB gzip, most of it React DOM. Every page is its own
chunk; the protocol stack loads on the first connection; locale catalogues load on demand; the TFT
pipeline loads only with the screen studio.

## Rust and WASM

Not used. OpenKey's protocol code is small, byte-oriented TypeScript that runs well under 1 ms per packet;
the only heavy work (TFT image conversion of 128×128 frames) runs in a few milliseconds. WASM would add a
toolchain and a larger download without a measured benefit. Revisit if a protocol needs heavy codecs
(for example large screen uploads on other families).

## Adding a keyboard

See [CONTRIBUTING_KEYBOARDS.md](CONTRIBUTING_KEYBOARDS.md).
