# Protocol sources and provenance

Every protocol or device fact OpenKey relies on is recorded with its source, evidence type and status.
Byte-level tables per family are in [`protocol/`](protocol/); this page lists the facts that decisions
depend on, and the sources they come from.

## Evidence statuses

| Status     | Meaning                                                                                         | May drive a write?                                                             |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| VERIFIED   | Observed on real hardware (hardware verification or controlled experiment)                      | yes, in normal UI if the safety class is safe                                  |
| OBSERVED   | Seen in a primary source: official driver code path, captures of official software, descriptors | only as an experimental write (opt-in)                                         |
| INFERRED   | One community source, a pattern, or a sibling device                                            | only as an experimental write, and only where the adapter explicitly allows it |
| HYPOTHESIS | A guess                                                                                         | never                                                                          |
| UNKNOWN    | Nothing known                                                                                   | never                                                                          |
| NOT_TESTED | Implemented or documented, hardware test not run                                                | as for its source status                                                       |

Rule (enforced by `statusFromSource()` and reviews): only hardware evidence produces VERIFIED. A fact
from a sibling device or a similar keyboard is at most INFERRED. Disagreements between sources are
recorded, never resolved by picking one.

## Key facts

| Fact                                                                                               | Source                                                        | Evidence type                                 | Status                                             | Date       | Device / firmware                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ---------- | -------------------------------------------------- |
| AK820 MAX PLUS enumerates as `0C45:8009`, "AK820 MAX", manufacturer "SONiX", bcdDevice 1.07        | `re/usb/usb-descriptor.txt`                                   | descriptor                                    | VERIFIED                                           | 2026-10-07 | test unit, fw 1.07                                 |
| Control pipe: FF13:0001, 64-byte feature report, no report ID                                      | `re/descriptors/interface3.txt`                               | descriptor                                    | VERIFIED                                           | 2026-10-07 | same                                               |
| Data pipe: FF68:0061, 4096-byte output report                                                      | `re/descriptors/interface2.txt`                               | descriptor                                    | VERIFIED                                           | 2026-10-07 | same                                               |
| START `04 18` is acknowledged `04 18 00 01`                                                        | `fixtures/device-info/ak820-max-plus-start-handshake-hw.json` | hardware capture                              | VERIFIED                                           | 2026-10-07 | same, USB                                          |
| Per-key colour read `04 F5` returns 9 packets of `[n,R,G,B]`                                       | `fixtures/rgb/ak820-max-plus-read-per-key-hw.json`            | hardware capture                              | VERIFIED                                           | 2026-10-07 | same, USB                                          |
| Every acknowledgement echoes its command; a passive read returns the previous echo                 | research log 2026-10-07/08                                    | hardware capture                              | VERIFIED                                           | 2026-10-08 | same                                               |
| All four USB interfaces declare bInterval 1 (1 ms)                                                 | `lsusb -v`, sysfs                                             | descriptor                                    | VERIFIED                                           | 2026-10-07 | same. Declared interval only; cadence not measured |
| Keymap, Fn layer, lighting, per-key write, macros, TFT, clock, settings packets                    | official Windows driver V1.0.0.5                              | official driver                               | OBSERVED, NOT_TESTED                               | 2026-10-07 | —                                                  |
| Firmware cannot report keymap, macros, lighting or settings                                        | official driver never reads them                              | official driver                               | OBSERVED                                           | 2026-10-07 | —                                                  |
| Battery readable only through the 2.4 GHz receiver                                                 | official driver `FUN_00435890`                                | official driver                               | OBSERVED                                           | 2026-10-07 | —                                                  |
| Settings are not configurable over Bluetooth                                                       | official driver message 62                                    | official driver                               | OBSERVED                                           | 2026-10-07 | —                                                  |
| Macro trigger-mode byte values                                                                     | AJAZZ online driver                                           | official driver (other family)                | INFERRED                                           | 2026-10-07 | —                                                  |
| Lighting direction codes (left 0, right 1, up 2, down 3)                                           | official driver UI vs community                               | official driver; conflict recorded            | OBSERVED, conflict                                 | 2026-10-07 | —                                                  |
| bcdDevice equals the firmware version                                                              | —                                                             | —                                             | HYPOTHESIS                                         | —          | —                                                  |
| `258A:010C` is used by both the AULA F75 and the AJAZZ AK820 MAX PLUS "BY edition"                 | official AJAZZ driver; AULA community projects                | official driver + public RE                   | OBSERVED (conflict of identity)                    | 2026-10-08 | —                                                  |
| AULA F75 configuration: feature report ID 6, 520 bytes including ID                                | cloudglides/aula-f75-linux-drivers, not-ayan/openaula         | public RE                                     | INFERRED; sources disagree on keymap header byte 6 | 2026-10-08 | not tested                                         |
| ROYUAN settings channel: FFFF:0002, 64-byte feature report; opcodes collide between yc500 and gen2 | Sharkfin `docs/PROTOCOL.md`                                   | public RE (with the project's own [HW] marks) | INFERRED for OpenKey                               | 2026-10-08 | not tested                                         |
| VIA/Vial raw HID: FF60:0061, 32-byte reports                                                       | QMK documentation                                             | public specification                          | OBSERVED                                           | 2026-10-08 | not tested                                         |

## Sources

| Source                                                           | Used for                                 | License / status                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| AJAZZ Windows driver "AK820 MAX&MAX PLUS … ColorScreen" V1.0.0.5 | `sonix-feature` protocol                 | proprietary; analysed locally, never committed; protocol facts re-expressed in our own words |
| AJAZZ online driver (ajazz.driveall.cn), bundle 2026-09-11       | `sonix-aa55` protocol                    | proprietary; same handling                                                                   |
| Public AK820 projects (18 surveyed)                              | cross-checks, conflicts                  | see [reverse-engineering/public-research.md](reverse-engineering/public-research.md)         |
| Sharkfin (ROYUAN)                                                | planned ROYUAN adapter signature         | GPL-3.0-or-later; facts only, no code                                                        |
| AULA F75 projects                                                | planned AULA adapter signature           | no license; facts only, no code                                                              |
| QMK / VIA / Vial documentation                                   | planned Vial adapter, VIA identification | GPL; facts only, no code                                                                     |

Detailed analysis: [reverse-engineering/official-driver-analysis.md](reverse-engineering/official-driver-analysis.md),
[RESEARCH_LOG.md](RESEARCH_LOG.md), [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md).
