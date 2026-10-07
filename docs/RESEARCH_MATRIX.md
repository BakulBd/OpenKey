# Research matrix

External projects reviewed once, on 2026-10-08, for architecture and protocol lessons. AK820-specific
projects are compared in more depth in
[reverse-engineering/public-research.md](reverse-engineering/public-research.md).

No source code from these projects is copied into OpenKey. Projects without a license grant no
permission to reuse code at all; GPL projects are used only as documentation of protocol facts, which
OpenKey re-implements independently (see [LICENSE_NOTES.md](LICENSE_NOTES.md)).

Legend: ✓ implemented by the project · ◐ partial or read-only · — absent · ? not established.

## Scope and capabilities

| Project | Scope | Protocol | Transport | Device model | Keymap | RGB | Macros | TFT | Hall effect | Browser | Desktop | License |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [Sharkfin](https://github.com/dniminenn/sharkfin) | 1386 ROYUAN-based boards (Attack Shark, Akko, Epomaker …) | ROYUAN, two command sets (yc500, gen2) | 64 B feature reports, vendor page `FFFF:2`; receiver relay | per-board records extracted from vendor data; family read from the board | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Rust → WASM) | ✓ (Tauri) | GPL-3.0-or-later |
| [Zumap / Keylab](https://github.com/Keylab-dev/keylab) | VIA-definition keymap editor | none (no device I/O) | — | VIA definition JSON | ◐ export only | — | — | — | — | ✓ (Next.js) | — | MIT |
| [VIA](https://github.com/the-via/app) | QMK boards with VIA enabled | VIA raw-HID commands | 32 B output/input, `FF60:61` | external definition repo (JSON v3) | ✓ | ✓ | ✓ | — | — | ✓ | — | GPL-3.0 |
| [Vial](https://github.com/vial-kb/vial-gui) | Vial-QMK boards | Vial (VIA superset) | 32 B raw HID `FF60:61` | definition stored **in firmware** (compressed JSON) | ✓ | ✓ | ✓ | — | — | ◐ (Qt → WASM) | ✓ | GPL-2.0 |
| [Vialite](https://github.com/tcyeee/vialite) | Vial boards | Vial, re-implemented in TS | WebHID | read from firmware | ✓ | ✓ | ✓ | — | — | ✓ | — | GPL-2.0 |
| [QMK Configurator](https://github.com/qmk/qmk_configurator) | QMK firmware builder | none at runtime | — | `info.json` from qmk_firmware | ◐ compile-time | — | — | — | — | ✓ (needs compile API server) | — | not detected by GitHub |
| [ZMK Studio](https://github.com/zmkfirmware/zmk-studio) | ZMK boards with Studio RPC | protobuf RPC | Web Serial, BLE GATT | physical layouts reported by firmware | ✓ | — | — | — | — | ✓ | ✓ (Tauri) | Apache-2.0 |
| [OpenAula (not-ayan)](https://github.com/not-ayan/openaula) | AULA F75 | AULA/SinoWealth-style tables | feature report ID 6, 519 B payload | single model | ✓ | — | — | — | — | ✓ (Vercel) | — | none |
| [AULA F75 Linux drivers (cloudglides)](https://github.com/cloudglides/aula-f75-linux-drivers) | AULA F75 | same family | wired: feature ID 6, 520 B; dongle `3554:FA09`: output ID `0x13`, 20 B | single model + OEM `KB.ini` | ✓ | ✓ | ◐ local only | — | — | ✓ | — | none |
| [OpenAULA (cvsqwe)](https://github.com/cvsqwe/OpenAula) | AULA F75 | same family | daemon + local web server | single model | ✓ | ✓ | ✓ | — | ? | ◐ (needs daemon) | ✓ | none |
| [Work Louder Creator Micro 2 kit](https://github.com/00cyre/creator-micro-kit) | Creator Micro 2 | JSON-RPC on vendor raw HID | USB and **BLE, same protocol** | single model | ◐ | ✓ | — | — | — | — | ✓ (Node, macOS) | MIT |
| [AK820 Pro unofficial webdriver](https://github.com/MemerGamer/AjazzAk820ProUnofficialWebdriver) | AJAZZ AK820 Pro | `04`-framed feature reports (same family as OpenKey's flagship) | `FF13` feature | single model | ? | ✓ | ? | ✓ | — | ✓ | — | MIT |
| [sinowisp](https://github.com/carlossless/sinowisp) / [SMK](https://github.com/carlossless/smk) | SinoWealth 8051 MCUs | ISP bootloader | HID feature, bootloader mode | per-MCU platform table | — | — | — | — | — | — | ✓ (CLI) | MIT / GPL-2.0 |
| [OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB) | RGB on hundreds of devices | per-vendor controllers | HID, SMBus, USB, network | `RGBController`: zones, LEDs, modes | — | ✓ | — | — | — | — | ✓ (Qt) | GPL-2.0 |

## Lessons

| Project | Useful idea (adopted) | Limitation / not adopted |
|---|---|---|
| Sharkfin | Resolve the command family from the board's own answers, never the USB PID; opcodes collide between families, so a misaddressed write hits a live register. Layout pictures stay read-only until checked against the board's own keymap. Slider previews are local and only the release writes, because lighting lives in flash. Per-key paint is sent manually and rate-limited. A "Contribute" tab collects a read-only bundle. Evidence markers ([HW]/[FW]/[JS]) on every protocol fact. | GPL-3.0: no code reuse in an MIT project. Rust/WASM core is justified by its codec size; OpenKey's protocol code is small and stays TypeScript (see [ARCHITECTURE.md](ARCHITECTURE.md#rust-and-wasm)). |
| Zumap / Keylab | A fully client-side, definition-driven renderer is enough for a convincing demo. | No device I/O; the definitions are not verified against hardware. |
| VIA | Keyboard definitions separate from the app; keycode catalogue with search. | Definitions are trusted without asking the firmware; a separate definitions repository is a contributor bottleneck. |
| Vial | The firmware carries its own definition, so the app cannot pick the wrong layout; an **unlock** step (hold physical keys) guards dangerous operations. | Desktop-first; the web build is a Qt app compiled to WASM (large). |
| Vialite | Pages that need a capability are hidden or disabled when the board lacks it; hand-rolled dictionary i18n without a library is sufficient. | GPL-2.0. |
| QMK Configurator | Large, searchable keycode catalogue. | Depends on a compile server; OpenKey must not. |
| ZMK Studio | Transport-agnostic RPC; physical unlock before writes; firmware reports physical layouts. | Web Serial and BLE, not WebHID; ZMK-only. |
| OpenAula / AULA F75 projects | "Save trace" support bundles; discovering offsets by **read-only** snapshots and diffs while pressing on-board controls; snapshot defaults before experimenting. | No licenses (code cannot be reused). The two sources **disagree** on the keymap frame header (byte 6 `0xFF` vs `0x02`). Unclear MCU (SinoWealth vs "Telink/EVVision"). Settings over the dongle unsolved. |
| Work Louder | Some devices *do* configure over BLE with the same protocol, which is why configuration transport must be declared per device and never inferred. | macOS native bridge; not a browser design. |
| AK820 Pro webdriver | Confirms the `04`-framed feature-report family on another AK820 model. | Single model, hard-coded identity. |
| sinowisp / SMK | Even a flash **read** through the ISP bootloader modifies flash (LJMP opcode). Bootloader access is never "read-only". | Firmware tooling: out of scope for OpenKey. |
| OpenRGB | `RGBController` separates zones, LEDs and modes from the transport; detectors are registered per family. | RGB only; desktop; GPL-2.0. Some detectors key on VID/PID alone. |

## Facts recorded for future adapters

Recorded with the source's own evidence level. None of these is verified by OpenKey.

| Fact | Source | Source's evidence | OpenKey status |
|---|---|---|---|
| ROYUAN settings channel: 64 B feature reports, report ID 0, vendor page `0xFFFF` usage 2 (some boards usage 1; one Mac-mode board uses its keyboard collection) | Sharkfin `docs/PROTOCOL.md` | [HW] | OBSERVED (third party), NOT_TESTED |
| ROYUAN checksum `0xFF - (sum & 0xFF)` over bytes 0..6 (byte 7) or 0..7 (byte 8) | Sharkfin | [HW] | OBSERVED (third party), NOT_TESTED |
| ROYUAN identify opcode `0x8F` is common to both command sets | Sharkfin | [HW] | OBSERVED (third party), NOT_TESTED |
| ROYUAN opcodes `0xAC`, `0x2C`, `0x7F`, `0x30` are destructive (erase, boot entry) | Sharkfin | [FW]/[JS] | must never be sent |
| AULA F75 wired `258A:010C`, configuration via feature report ID 6, 520 B including the ID | cloudglides, not-ayan | not stated / hardware use implied | OBSERVED (third party), NOT_TESTED |
| AULA F75 dongle `3554:FA09`, output report ID `0x13`, 20 B, per-key colour stream | cloudglides | not stated | OBSERVED (third party), NOT_TESTED |
| `258A:010C` is also reported for an AJAZZ "AK820 MAX" with a SinoWealth MCU | MedSlimane project (see public-research.md) | not stated | conflict: same VID:PID, product identity unresolved |
| Vial/VIA raw HID: usage page `0xFF60`, usage `0x61`, 32 B reports | QMK documentation | public spec | OBSERVED (public spec), NOT_TESTED by OpenKey |
