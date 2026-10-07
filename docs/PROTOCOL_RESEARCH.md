# Protocol research

Where OpenKey's protocol knowledge lives and how it grows.

## Families

| Family                                                                  | Adapter status | Specification                                                               | Hardware evidence                                                |
| ----------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `sonix-feature` (AJAZZ Windows driver; AK820 MAX / MAX PLUS, AK820 Pro) | experimental   | [protocol/sonix-feature.md](protocol/sonix-feature.md)                      | START handshake, per-key read, ack echo (AK820 MAX PLUS fw 1.07) |
| `sonix-aa55` (AJAZZ online driver; AK820 Pro, AK820 MAX HE)             | community      | [protocol/sonix-aa55.md](protocol/sonix-aa55.md)                            | none by OpenKey                                                  |
| `sonix-dongle` (2.4 GHz receivers)                                      | research       | [protocol/other-families.md](protocol/other-families.md)                    | none                                                             |
| `crs-aa55cc33` (CRS-MCU AK820 Max Plus)                                 | research       | [protocol/other-families.md](protocol/other-families.md)                    | none                                                             |
| `qmk-via` (community QMK)                                               | research       | [protocol/other-families.md](protocol/other-families.md)                    | none                                                             |
| `aula-sinowealth` (AULA F75 and similar)                                | planned        | [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md#facts-recorded-for-future-adapters) | none                                                             |
| `royuan` (Attack Shark, Akko, Epomaker … per Sharkfin)                  | planned        | [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md#facts-recorded-for-future-adapters) | none                                                             |
| `vial`                                                                  | planned        | QMK/Vial documentation                                                      | none                                                             |

Supporting material:

- [RESEARCH_LOG.md](RESEARCH_LOG.md) — dated observations with evidence status.
- [PROTOCOL_SOURCES.md](PROTOCOL_SOURCES.md) — provenance of the facts decisions depend on.
- [reverse-engineering/official-driver-analysis.md](reverse-engineering/official-driver-analysis.md) — how the official driver was analysed.
- [reverse-engineering/public-research.md](reverse-engineering/public-research.md) — 18 public AK820 projects compared, conflicts recorded.
- [reverse-engineering/capture-methodology.md](reverse-engineering/capture-methodology.md) — how to capture.
- `re/` — raw evidence (USB/HID descriptors, captures, the feature-read tool). Never edited.
- `fixtures/` — captured exchanges with expected decoding; hardware fixtures end in `-hw.json`.

## Method

1. **Inspect** descriptors (Research lab or `pnpm inspect`). Descriptors decide which family can apply.
2. **Capture** the official software making one change at a time (before/after).
3. **Read-only experiments first.** Diff read-backs while changing settings on the keyboard itself
   (the technique the AULA projects use) before ever writing.
4. **Write the spec** with an evidence status per field; record conflicts instead of choosing.
5. **Fixture + test** for every verified exchange; simulator for the rest.
6. **Verify on hardware** one operation at a time, with read-back where the firmware allows, and record
   it in [HARDWARE_TEST_MATRIX.md](HARDWARE_TEST_MATRIX.md).

Checksums are accepted only when several independent samples prove them. Report IDs come from
descriptors or captures. Polling is measured, never derived from bInterval. Wireless behaviour is tested,
never assumed from the wired protocol.

## Open questions (AK820 MAX PLUS)

- Do keymap, lighting, settings and TFT writes behave as the official driver code implies? (needs consent)
- Lighting direction code mapping (sources conflict).
- Macro trigger-mode byte values (borrowed from another family).
- Is bcdDevice the firmware version?
- Measured report cadence over USB and 2.4 GHz.
- Does the echo buffer clear after SAVE or after a timeout (single observation)?
