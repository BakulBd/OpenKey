# Source review (2026-10-11)

What OpenKey took from each open-source project on the owner's list, what it deliberately did not take,
and how carefully each was read. Licences are GitHub's SPDX detection on 2026-10-11 (re-check before any
reuse); "none" means no licence was detected, which means **no reuse rights** for code.

OpenKey is MIT. It reuses **facts** (command numbers, packet layouts, keycode values, model tables)
re-implemented independently; it copies **no code** from GPL or unlicensed projects. A definition or a
resemblance never unlocks a write: every adapter still identifies the keyboard first.

Depth: **read** = source read for this review and cross-checked against OpenKey; **skimmed** = layout and
key files looked at; **licence only** = licence and activity checked, not read in depth this session.

## Configurators and firmware ecosystems

| Project | Licence | Depth | What OpenKey uses / learned | Not used |
| ------- | ------- | ----- | --------------------------- | -------- |
| [QMK firmware](https://github.com/qmk/qmk_firmware) (`quantum/via.h`, `via.c`, `dynamic_keymap.c`, `keycodes.h`, `send_string.c`) | GPL-2.0 | read | The whole **VIA adapter** (`packages/protocols/src/families/via`): command ids, 32-byte framing, bulk keymap/macro transfers (≤ 28 bytes), lighting channels and value ids, keycode v2 ranges, the dynamic-macro byte format, which commands reset or reflash (never sent). | No code. Keycode **names** are a small curated table. |
| [VIA app](https://github.com/the-via/app), [keyboards](https://github.com/the-via/keyboards), [specification](https://github.com/the-via/website/blob/master/docs/specification.md) | GPL-3.0 | skimmed | Definition format (matrix + KLE layout, layout options in legend 8, `menus` for lighting); keycodes v1/v2 split by protocol version; lighting effect lists assume all effects compiled in (OpenKey says so and shows the number). | Definitions are **not bundled** (GPL-3.0 repository); users load their own file. |
| [Vial GUI](https://github.com/vial-kb/vial-gui), [vial-qmk](https://github.com/vial-kb/vial-qmk), [Vialite](https://github.com/tcyeee/vialite) | GPL-2.0 | licence only | Vial firmware answers VIA commands, so Vial boards get keymaps, macros and lighting through the VIA adapter. | Vial's in-firmware definition (LZMA), tap dance, combos, unlock: future work. |
| [Remap](https://github.com/remap-keys/remap) | not detected | licence only | Browser-first QMK workflow confirms the definition-import UX. | — |
| [Keylab](https://github.com/Keylab-dev/keylab) / [Zumap](https://github.com/Keylab-dev/zumap) | MIT / GPL-3.0 | licence only | Keeping layout data separate from device I/O — already OpenKey's structure (`KeyboardLayout` vs drivers). | — |
| [ZMK](https://github.com/zmkfirmware/zmk), [Studio messages](https://github.com/zmkfirmware/zmk-studio-messages) | MIT | licence only | Candidate future adapter (protobuf RPC over serial/BLE; not WebHID). | Not started: needs Web Serial and a ZMK board. |
| [Sharkfin](https://github.com/dniminenn/sharkfin) | GPL-3.0 | read (PROTOCOL.md) | The **ROYUAN adapter**: transport, Bit7/Bit8 checksums, identify `0x8F`, revision `0x80` (zeros on gen2), lighting `0x87`/`0x07`, speed inversion per command set, the "unknown command replays the last reply" rule, and the destructive opcode list (refused). | No code and no board database; keymap/macro/settings opcodes collide between command sets, so they are not written. The receiver relay is documented but not implemented. |
| [ReConf](https://github.com/ReBotLab/ReConf) / [hmkconf](https://github.com/peppapighs/hmkconf) | GPL-3.0 | licence only | Hall-effect features stay capability-gated (`actuation`, `rapidTrigger`, `socd`, `dks` are UNKNOWN unless an adapter proves them). | — |
| [Micro 2 configurator](https://github.com/egegungordu/micro2-configurator) | none | licence only | Pattern only: framing separate from UI, read-back after writes (OpenKey does the same). | No code (no licence). |
| [W910 webdriver](https://github.com/luftaquila/w910-webdriver) | GPL-3.0 | licence only | Reminder that a link carrying settings must be proven per keyboard; OpenKey declares configuration links per adapter. | — |
| [Keyboard Layout Editor](https://github.com/ijprest/keyboard-layout-editor) | not detected | skimmed (format) | KLE row/props semantics for the VIA definition parser (x, y, w, h, rx/ry, decals). | No code. |
| [QMK Configurator](https://github.com/qmk/qmk_configurator) | none | licence only | `info.json` layouts (`matrix`, `x`, `y`, `w`, `h`) are importable as definitions. | — |

## AJAZZ / AK820

| Project | Licence | Depth | Finding |
| ------- | ------- | ----- | ------- |
| [gusleig/ajazz-ak820-pro-mac](https://github.com/gusleig/ajazz-ak820-pro-mac) | MIT | read (protocol) | Same session commands as OpenKey (`18` begin, `02` commit, `F0` save/finish, `55 AA` / `AA 55` trailers). Calls `0x27` "remap (wireless)" without a layout — **disagrees** with the official-driver analysis (Fn table) and with VitalyArt ("reset lighting"). Recorded in the ledger; the owner's test confirms the Fn-table behaviour on `0C45:8009` over USB. |
| [wsclx/ak820pro-modder](https://github.com/wsclx/ak820pro-modder) | MIT | read (keymap) | Online-driver key-slot page enum (DEFAULT 0 … MPT 15) **matches** OpenKey's `Page` table exactly, after they corrected their own earlier error — independent confirmation of the sonix-aa55 codec. |
| [MemerGamer WebHID driver](https://github.com/MemerGamer/AjazzAk820ProUnofficialWebdriver) | MIT | skimmed | Single-model WebHID app (AK820 Pro); nothing beyond what the ledger has. |
| [fpb/ajazz-ak820-pro](https://github.com/fpb/ajazz-ak820-pro) | GPL-2.0 | read (earlier phase) | QMK port: raw HID FF60:61 → the VIA adapter now configures such boards. |
| [gohv](https://github.com/gohv/EPOMAKER-Ajazz-AK820-Pro), [TaxMachine](https://github.com/TaxMachine/ajazz-keyboard-software-linux) | none | skimmed | AK820 Pro screen tools; no licence, so facts only and already covered by the ledger. |

AK820 Pro projects are **leads**, not proof, for the AK820 MAX (`0C45:8009`): OpenKey's MAX evidence is
the official driver analysis plus the owner's hardware test.

## AULA, RK and SinoWealth

| Project | Licence | Depth | Finding |
| ------- | ------- | ----- | ------- |
| [leisiji/AulaSofwareLinux](https://github.com/leisiji/AulaSofwareLinux) | MIT (LICENSE file) | read | Basis of the **BY Tech adapter**: 519-byte command report, model code via `82 01`, settings page `84`/`04` with `5A A5` marker, per-effect table. Its F75 page capture is the simulator's test data. |
| [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver) | MIT | read (earlier phase) | The F75 **Max** uses the AJAZZ/Sonix command set on `0C45:800A` — a different protocol from the plain F75. "AULA" is a brand, not a protocol. |
| [cloudglides](https://github.com/cloudglides/aula-f75-linux-drivers), [not-ayan/openaula](https://github.com/not-ayan/openaula), [RustamSheoran](https://github.com/RustamSheoran/aula-f75), [Le-Maxime](https://github.com/Le-Maxime/Aula-F75-Web-Driver), [marcoslor](https://github.com/marcoslor/Aula-F87-Controller) | none | skimmed | Same 519-byte channel; sources disagree on the keymap frame header, so OpenKey does not write keymaps for this family yet. |
| [Ahorts/aula-f87pro](https://github.com/Ahorts/aula-f87pro), [vndarkblue/aula-keybind](https://github.com/vndarkblue/aula-keybind) | MIT | licence only | Next to read for the keymap encoding. |
| [veysiemrah](https://github.com/veysiemrah/aula-rgb-controller), [cvanelteren/OpenAula](https://github.com/cvanelteren/OpenAula) | GPL-3.0 | licence only | — |
| [KludgeKnight](https://github.com/vinc3m1/kludgeknight), [Rangoli](https://github.com/rnayabed/rangoli) | GPL-3.0 | read | Basis of the **classic RK adapter**: the 0x0A lighting/sleep packet, both effect numberings, and the 78 models RK's software lists that Rangoli users report working (PID, name, RGB flag — facts only). The RK R75 RGB (`258A:015E`) does **not** use this protocol; it speaks BY Tech. | Key-map tables (per-model `KB.ini` data) and per-key colour maps are not copied, so RK key maps are not written yet. |
| [SinoWisp](https://github.com/carlossless/sinowisp) | MIT | licence only | ISP/bootloader tooling: **out of scope**; OpenKey never sends flash or erase commands. A SinoWealth MCU says nothing about the configuration protocol. |

## Other references

OpenRGB (GPL-2.0, lighting SDK, not a configurator), MCHOSE Local Hub (mice; adjacent only), HIDAPI and
node-hid (BSD/MIT-style; node-hid is the CLI's macOS/Windows backend), the USB HID 1.11 specification,
HID Usage Tables, WebHID (WICG, MDN, Chrome docs) and Linux hidraw documentation remain the references
for transport behaviour. Protected collections (keyboard, mouse, system control) are not configurable
from WebHID, and OpenKey never tries.
