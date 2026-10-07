# Architecture

```
                         apps/web (React, WebHID)        tools/cli (Node, hidraw)
                                    \                          /
                                     \                        /
                              @openak820/protocols: ProtocolRegistry
                       detect(group) → match (descriptors) → probe (read-only) → select
                                 |            |            |          |          |
                          sonix-feature  sonix-aa55  sonix-dongle  qmk-via  crs-aa55cc33
                                 \            |            /
                              families/common (key slots, per-key entries)
                                              |
                         @openak820/core: KeyboardDriver, model, errors, backup, StateStore
                                              |
                         @openak820/hid: HidTransport, descriptor parser, WebHID, mock, replay
                         @openak820/hid-node: Linux sysfs enumeration + hidraw transport (node-hid)
                         @openak820/tft: RGB565, fit, dither, GIF decode, test patterns
                         @openak820/profiles: model profiles (profiles/*.json) and layouts
```

## Principles

- **Detection never trusts VID/PID alone.** Each protocol matches on collections (usage page, usage, report
  sizes) and confirms with a read-only probe. Profiles (VID/PID/product string) only rank candidates; if two
  protocols tie, detection reports ambiguity instead of picking one.
- **Protocol code never touches a platform API.** It talks to `HidTransport`; `navigator.hid` lives in
  `WebHidTransport`, hidraw in `LinuxHidRawTransport`, tests use `MockHidTransport`/`replayBehavior`.
  ESLint forbids `navigator`, `node:*` and `node-hid` imports inside protocol/core/tft code.
- **One common API.** `KeyboardDriver` (core/driver.ts) is implemented per family; unsupported features
  throw `UnsupportedFeatureError` and `getCapabilities()` tells the UI what to show.
- **Mirrors for write-only firmware.** Families whose firmware cannot report a setting store what they
  wrote in a `StateStore` (localStorage in the browser, a JSON file for the CLI), marked `provenance:
'mirror'` everywhere it is shown or backed up.
- **No duplication.** Encodings shared by families live in `families/common`; family code keeps only
  what differs (framing, table sizes, page-5 functions, macro layout).
- **Every magic number is a named constant with its evidence** (`families/*/constants.ts`).

## Adding a keyboard

1. Run `pnpm inspect` and share the output (no device access needed).
2. If its descriptors match an existing family, add a profile in `profiles/` and a layout in
   `packages/profiles/src/layouts/`, and map its product string in the family's variant table.
3. Otherwise, capture the official software (see `docs/reverse-engineering/capture-methodology.md`),
   document the protocol, and add a family under `packages/protocols/src/families/` with `match`, a
   read-only `probe`, a driver, a simulator and tests.
