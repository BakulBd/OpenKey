9# Source review (2026-10-11)

What OpenKey took from each open-source project on the owner's list, what it deliberately did not take,
and how carefully each was read. Licences are GitHub's SPDX detection on 2026-10-11 (re-check before any
reuse); "none" means no licence was detected, which means **no reuse rights** for code.

OpenKey is MIT. It reuses **facts** (command numbers, packet layouts, keycode values, model tables)
re-implemented independently; it copies **no code** from GPL or unlicensed projects. A definition or a
resemblance never unlocks a write: every adapter still identifies the keyboard first.

Depth: **read** = source read for this review and cross-checked against OpenKey; **skimmed** = layout and
key files looked at; **licence only** = licence and activity checked, not read in depth this session.

## Configurators and firmware ecosystems

| Project                                                                                                                                                                             | Licence       | Depth              | What OpenKey uses / learned                                                                                                                                                                                                                                                 | Not used                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [QMK firmware](https://github.com/qmk/qmk_firmware) (`quantum/via.h`, `via.c`, `dynamic_keymap.c`, `keycodes.h`, `send_string.c`)                                                   | GPL-2.0       | read               | The whole **VIA adapter** (`packages/protocols/src/families/via`): command ids, 32-byte framing, bulk keymap/macro transfers (≤ 28 bytes), lighting channels and value ids, keycode v2 ranges, the dynamic-macro byte format, which commands reset or reflash (never sent). | No code. Keycode **names** are a small curated table.                                                                                                                                                                                                                                          |
| [VIA app](https://github.com/the-via/app), [keyboards](https://github.com/the-via/keyboards), [specification](https://github.com/the-via/website/blob/master/docs/specification.md) | GPL-3.0       | skimmed            | Definition format (matrix + KLE layout, layout options in legend 8, `menus` for lighting); keycodes v1/v2 split by protocol version; lighting effect lists assume all effects compiled in (OpenKey says so and shows the number).                                           | Definitions are **not bundled** (GPL-3.0 repository); users load their own file.                                                                                                                                                                                                               |
| [Vial GUI](https://github.com/vial-kb/vial-gui), [vial-qmk](https://github.com/vial-kb/vial-qmk), [Vialite](https://github.com/tcyeee/vialite)                                      | GPL-2.0       | licence only       | Vial firmware answers VIA commands, so Vial boards get keymaps, macros and lighting through the VIA adapter.                                                                                                                                                                | Vial's in-firmware definition (LZMA), tap dance, combos, unlock: future work.                                                                                                                                                                                                                  |
| [Remap](https://github.com/remap-keys/remap)                                                                                                                                        | not detected  | licence only       | Browser-first QMK workflow confirms the definition-import UX.                                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                              |
| [Keylab](https://github.com/Keylab-dev/keylab) / [Zumap](https://github.com/Keylab-dev/zumap)                                                                                       | MIT / GPL-3.0 | licence only       | Keeping layout data separate from device I/O — already OpenKey's structure (`KeyboardLayout` vs drivers).                                                                                                                                                                   | —                                                                                                                                                                                                                                                                                              |
| [ZMK](https://github.com/zmkfirmware/zmk), [Studio messages](https://github.com/zmkfirmware/zmk-studio-messages)                                                                    | MIT           | licence only       | Candidate future adapter (protobuf RPC over serial/BLE; not WebHID).                                                                                                                                                                                                        | Not started: needs Web Serial and a ZMK board.                                                                                                                                                                                                                                                 |
| [Sharkfin](https://github.com/dniminenn/sharkfin)                                                                                                                                   | GPL-3.0       | read (PROTOCOL.md) | The **ROYUAN adapter**: transport, Bit7/Bit8 checksums, identify `0x8F`, revision `0x80` (zeros on gen2), lighting `0x87`/`0x07`, speed inversion per command set, the "unknown command replays the last reply" rule, and the destructive opcode list (refused).            | No code and no board database; macro/settings opcodes collide between command sets, so they are not written; key maps are read on both sets and written only on yc500 (single-slot `0x13`/`0x15`, hardware-tested there) with read-back. The receiver relay is documented but not implemented. |
| [ReConf](https://github.com/ReBotLab/ReConf) / [hmkconf](https://github.com/peppapighs/hmkconf)                                                                                     | GPL-3.0       | licence only       | Hall-effect features stay capability-gated (`actuation`, `rapidTrigger`, `socd`, `dks` are UNKNOWN unless an adapter proves them).                                                                                                                                          | —                                                                                                                                                                                                                                                                                              |
| [Micro 2 configurator](https://github.com/egegungordu/micro2-configurator)                                                                                                          | none          | licence only       | Pattern only: framing separate from UI, read-back after writes (OpenKey does the same).                                                                                                                                                                                     | No code (no licence).                                                                                                                                                                                                                                                                          |
| [W910 webdriver](https://github.com/luftaquila/w910-webdriver)                                                                                                                      | GPL-3.0       | licence only       | Reminder that a link carrying settings must be proven per keyboard; OpenKey declares configuration links per adapter.                                                                                                                                                       | —                                                                                                                                                                                                                                                                                              |
| [Keyboard Layout Editor](https://github.com/ijprest/keyboard-layout-editor)                                                                                                         | not detected  | skimmed (format)   | KLE row/props semantics for the VIA definition parser (x, y, w, h, rx/ry, decals).                                                                                                                                                                                          | No code.                                                                                                                                                                                                                                                                                       |
| [QMK Configurator](https://github.com/qmk/qmk_configurator)                                                                                                                         | none          | licence only       | `info.json` layouts (`matrix`, `x`, `y`, `w`, `h`) are importable as definitions.                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                              |

## AJAZZ / AK820

| Project                                                                                                                             | Licence | Depth                | Finding                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [gusleig/ajazz-ak820-pro-mac](https://github.com/gusleig/ajazz-ak820-pro-mac)                                                       | MIT     | read (protocol)      | Same session commands as OpenKey (`18` begin, `02` commit, `F0` save/finish, `55 AA` / `AA 55` trailers). Calls `0x27` "remap (wireless)" without a layout — **disagrees** with the official-driver analysis (Fn table) and with VitalyArt ("reset lighting"). Recorded in the ledger; the owner's test confirms the Fn-table behaviour on `0C45:8009` over USB. |
| [wsclx/ak820pro-modder](https://github.com/wsclx/ak820pro-modder)                                                                   | MIT     | read (keymap)        | Online-driver key-slot page enum (DEFAULT 0 … MPT 15) **matches** OpenKey's `Page` table exactly, after they corrected their own earlier error — independent confirmation of the sonix-aa55 codec.                                                                                                                                                               |
| [Beattrey/ajazz-ak820-config](https://github.com/Beattrey/ajazz-ak820-config)                                                       | MIT     | read (time, image)   | Clock packet matches OpenKey's `TIME` entry. Reports AK820 **Pro** still-image framing that differs from the MAX (no 256-byte header, sub `02`, closed with `F0`); recorded in the ledger, Pro uploads stay experimental with a warning.                                                                                                                         |
| [kabelklaus/ajazz-ak820-pro](https://github.com/kabelklaus/ajazz-ak820-pro)                                                         | MIT     | skimmed              | Single-file WebHID app for the AK820 Pro using the same session commands (`18`, `28`, `02`).                                                                                                                                                                                                                                                                     |
| [MemerGamer WebHID driver](https://github.com/MemerGamer/AjazzAk820ProUnofficialWebdriver)                                          | MIT     | skimmed              | Single-model WebHID app (AK820 Pro); nothing beyond what the ledger has.                                                                                                                                                                                                                                                                                         |
| [fpb/ajazz-ak820-pro](https://github.com/fpb/ajazz-ak820-pro)                                                                       | GPL-2.0 | read (earlier phase) | QMK port: raw HID FF60:61 → the VIA adapter now configures such boards.                                                                                                                                                                                                                                                                                          |
| [gohv](https://github.com/gohv/EPOMAKER-Ajazz-AK820-Pro), [TaxMachine](https://github.com/TaxMachine/ajazz-keyboard-software-linux) | none    | skimmed              | AK820 Pro screen tools; no licence, so facts only and already covered by the ledger.                                                                                                                                                                                                                                                                             |

AK820 Pro projects are **leads**, not proof, for the AK820 MAX (`0C45:8009`): OpenKey's MAX evidence is
the official driver analysis plus the owner's hardware test.

### AK820 wired RGB (Moon switches), October 2026

The official AJAZZ driver "AK820 wired RGB" V1.0 is listed on ajazzstore.com and hosted by Epomaker.
It was unpacked (NSIS, then 7-Zip) and its data files and strings were read. Nothing was copied from it.

- It is the **EVision** driver, not the AK820 Pro/MAX one. Its default data names the
  `eevision_A_kb_001` firmware and the VS11K28A/VS11K34A chips.
- Its firmware updaters (V0102, V0103 beta) target **`320F:505B`**, firmware `0103`, with
  bootloader `0C45:7687`. That identity is in OpenRGB's EVision list, which OpenKey's `evision`
  adapter already used.
- The keyboard picture (`Skin/XML/DeviceXml/keyboarddevice.xml`) shows 82 keys, each with its light
  index. Several indices differ from OpenRGB's full-size map: Enter 75, Z 85, right Shift 95,
  Up 96, right Alt 109, Fn 110, arrows 113–115. With the full-size map those keys got the wrong
  colours.
- Brightness slider 0–4 (as OpenKey); speed slider 0–4, while OpenRGB uses 0–5. The effect codes
  are built in compiled code, so OpenKey keeps OpenRGB's documented list and speed mapping.

**What it changed:** `320F:505B` is shown as the AJAZZ AK820 wired RGB, with its own 82-key layout
from those indices and the knob. Lighting, effects, brightness, speed and per-key colours go through
the EVision adapter (community, untested by OpenKey). Key maps and macros stay unsupported: no open
source documents them for this firmware.

## AULA, RK and SinoWealth

| Project                                                                                                                                                                                                                                                                                                                   | Licence            | Depth                | Finding                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [leisiji/AulaSofwareLinux](https://github.com/leisiji/AulaSofwareLinux)                                                                                                                                                                                                                                                   | MIT (LICENSE file) | read                 | Basis of the **BY Tech adapter**: 519-byte command report, model code via `82 01`, settings page `84`/`04` with `5A A5` marker, per-effect table. Its F75 page capture is the simulator's test data.                                                                                     |
| [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver)                                                                                                                                                                                                                                         | MIT                | read (earlier phase) | The F75 **Max** uses the AJAZZ/Sonix command set on `0C45:800A` — a different protocol from the plain F75. "AULA" is a brand, not a protocol.                                                                                                                                            |
| [cloudglides](https://github.com/cloudglides/aula-f75-linux-drivers), [not-ayan/openaula](https://github.com/not-ayan/openaula), [RustamSheoran](https://github.com/RustamSheoran/aula-f75), [Le-Maxime](https://github.com/Le-Maxime/Aula-F75-Web-Driver), [marcoslor](https://github.com/marcoslor/Aula-F87-Controller) | none               | skimmed              | Same 519-byte channel; sources disagree on the keymap frame header, so OpenKey does not write keymaps for this family yet.                                                                                                                                                               |
| [pradyumnac/aula-f99-controller](https://github.com/pradyumnac/aula-f99-controller)                                                                                                                                                                                                                                       | MIT                | read                 | F99 receiver framing (`0x13`, 20 B, sum checksum) and model query `05`: basis of the **aula-receiver** adapter. Its cable writes fail (wrong framing for the cable).                                                                                                                     |
| [dnviti/aula-x99-pro-driver-linux](https://github.com/dnviti/aula-x99-pro-driver-linux)                                                                                                                                                                                                                                   | none               | read                 | F99 Pro receiver reads (`05`, `0B`, `44`, multi-page). Its receiver write opcodes overlap "apply"/"reset", and its page offsets contradict the verified cable layout, so no write is taken.                                                                                              |
| [vndarkblue/aula-keybind](https://github.com/vndarkblue/aula-keybind)                                                                                                                                                                                                                                                     | MIT                | read                 | Cable key-map framing (`03`, layer byte, 128 × 4-byte slots) agrees with leisiji; trailer position and read-back disagree, so key maps are not written yet. Details: docs/AULA_F99.md.                                                                                                   |
| [sgtflixy/AulaControl](https://github.com/sgtflixy/AulaControl)                                                                                                                                                                                                                                                           | Apache-2.0         | skimmed              | AULA Hall-effect boards (WIN60HE, `2E3C:C365`): a different protocol family from the F-series.                                                                                                                                                                                           |
| [Ahorts/aula-f87pro](https://github.com/Ahorts/aula-f87pro)                                                                                                                                                                                                                                                               | MIT                | licence only         | —                                                                                                                                                                                                                                                                                        |
| [veysiemrah](https://github.com/veysiemrah/aula-rgb-controller), [cvanelteren/OpenAula](https://github.com/cvanelteren/OpenAula)                                                                                                                                                                                          | GPL-3.0            | licence only         | —                                                                                                                                                                                                                                                                                        |
| [KludgeKnight](https://github.com/vinc3m1/kludgeknight), [Rangoli](https://github.com/rnayabed/rangoli)                                                                                                                                                                                                                   | GPL-3.0            | read                 | Basis of the **classic RK adapter**: the 0x0A lighting/sleep packet, both effect numberings, and the 78 models RK's software lists that Rangoli users report working (PID, name, RGB flag — facts only). The RK R75 RGB (`258A:015E`) does **not** use this protocol; it speaks BY Tech. | Key-map tables (per-model `KB.ini` data) and per-key colour maps are not copied, so RK key maps are not written yet. |
| [SinoWisp](https://github.com/carlossless/sinowisp)                                                                                                                                                                                                                                                                       | MIT                | licence only         | ISP/bootloader tooling: **out of scope**; OpenKey never sends flash or erase commands. A SinoWealth MCU says nothing about the configuration protocol.                                                                                                                                   |

## Other references

OpenRGB (GPL-2.0, lighting SDK, not a configurator), MCHOSE Local Hub (mice; adjacent only), HIDAPI and
node-hid (BSD/MIT-style; node-hid is the CLI's macOS/Windows backend), the USB HID 1.11 specification,
HID Usage Tables, WebHID (WICG, MDN, Chrome docs) and Linux hidraw documentation remain the references
for transport behaviour. Protected collections (keyboard, mouse, system control) are not configurable
from WebHID, and OpenKey never tries.

## User reports

### AULA NOVA75 (`05AC:024F` receiver "AULA-NOVA75-2"), macOS, October 2026

**What the report showed.** Over the receiver the browser saw only these collections:

| Collection        | Usage page:usage | Reports         |
| ----------------- | ---------------- | --------------- |
| Mouse             | 01:02            | none listed     |
| Consumer control  | 0C:01            | input report 8  |
| Consumer control  | 0C:01            | input report 17 |
| System multi-axis | 01:0E            | input report 9  |

No vendor page was visible.

**Sources checked:**

- [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver) (MIT) and
  [Ghost-CR/F75_Initializer](https://github.com/Ghost-CR/F75_Initializer) (no licence; facts only).
  These are the AULA F75 Max references the user supplied.
  - The F75 Max cable is `0C45:800A` with FF13 control (64-byte feature reports) and FF68 data
    (4096-byte output reports). Its commands — `04 18` start, `04 72` image, `04 13` lighting,
    `04 02` save, `04 f0` finish — are the AJAZZ Sonix protocol OpenKey implements and owner-verified
    on the AK820 MAX.
  - The receiver is `05AC:024F` with FF59 (command) and FF60 (raw, 32-byte reports, additive
    checksum at byte 31). Its lighting packet `05 10 00 MM RR GG BB … CC BR SP DI … aa 55` is
    byte-identical to OpenKey's receiver adapter. OpenKey's AK820 MAX receiver on Linux shows the
    same FF59/FF60/FFFF pages.
  - VitalyArt's macOS troubleshooting asks for the **Input Monitoring** permission when the
    receiver endpoints or acknowledgements are missing.
  - Conflict: Ghost-CR's `docs/protocol_sources.md` gives the colour bytes as BB GG RR, while its
    `PROTOCOL_REFERENCE.md` says RR GG BB, "verified on hardware". VitalyArt and OpenKey use RR GG BB.
- [not-ayan/openaula](https://github.com/not-ayan/openaula) and
  [sgtflixy/AulaControl](https://github.com/sgtflixy/AulaControl): other AULA platforms (BY Tech F75,
  WIN60HE/WIN75HE). No NOVA75 facts.
- The official AULA NOVA75 driver (Beta 1.0.0.2, Inno Setup installer) was unpacked and its
  configuration files read; nothing was copied from it.
  - `config.xml`: cable `0C45:800A`, product string `AULA-NOVA75`, interface MI_00; receiver
    `05AC:024F`, product string `2.4G Dongle`, interface MI_03. No Bluetooth mode.
  - `layouts/rgb-keyboard.xml`: `menu` enables macros, lighting, per-key, music and screen;
    `menu_wireless` the same without the screen. Settings: Fn layer, sleep, key response. Screen
    240 × 135, at most 107 frames, one slot, 256-byte header. Lighting default effect 11,
    brightness and speed 0–6. 80 keys, each key index equal to its light index.
  - `language/1033.lan`: sleep choices and the five key-response levels with wired, 2.4 GHz and
    Bluetooth latencies.
- VitalyArt's receiver code (MIT) also gives a `0F` packet sent 50 ms before each lighting packet,
  and the settings packet `07 10 00 00 01 01 01 01 FN SL 00 KR GM AT AF WN 00 aa 55`. Its direction
  labels (0 right, 1 down, 2 left, 3 up) differ from the official AJAZZ driver's (0 left, 1 right,
  2 up, 3 down); OpenKey keeps the official order until a receiver shows which is right.

**What it changed in OpenKey:**

- On macOS, the Connection doctor explains that a receiver showing only typing and media
  collections may have its configuration channel hidden, and gives the Input Monitoring steps.
  Detection now also says when a catalogued model's configuration interface is not visible.
- **Cable** (`0C45:800A`, `AULA-NOVA75`): a NOVA75 profile on the AJAZZ protocol, identified
  automatically (the identity is in the official configuration). It has the 80-key layout from
  `rgb-keyboard.xml` with the knob, the 240 × 135 screen capped at 107 frames, and brightness and
  speed 0–6. Macros, key maps, per-key colours, settings and clock work as on the owner-verified
  AK820 MAX PLUS.
- The 240 × 135 screen-size choice for unrecognised boards now caps uploads at 107 frames, the
  smallest limit among the boards with that screen.
- **Receiver** (`05AC:024F`): the receiver adapter names the NOVA75 and uses its layout and 0–6
  levels. It adds sleep, key response and game mode, which it cannot read back, and the `0F`
  lighting preamble. The ping is automatic for `2.4G Dongle`, the name in the official NOVA75
  configuration. `AULA-NOVA75-2` is not in that configuration, so it asks once. Per-key colours,
  macros and the screen need the cable.
- Every NOVA75 write is experimental until an owner confirms it.

**What would settle it:** one diagnostic with the cable in wired mode, and one from the receiver
after Input Monitoring is allowed. Also a note of whether a lighting change and the direction
setting do what the screen says.

**Tests:** `tests/protocol/shared-receiver.test.ts`, built from the reported descriptors (shapes
only), and `tests/integration/sonix-feature-variants.test.ts` for the cable.

### FL Esports MK870 (`0416:C345`, "Gaming Keyboard"), Linux, October 2026

**What the report showed.** A consumer collection, a mouse collection, and a vendor collection
`FF1B:0091` with input and output report 1 of 63 bytes. Its owner has run
[Mqlvin/keyboard-colour](https://github.com/Mqlvin/keyboard-colour) (MIT) on the keyboard
successfully.

**Sources checked:**

- **Mqlvin/keyboard-colour (MIT).** A USBPcap capture of the vendor software. It gives the lighting
  packet `07 00 00 00 0E mode brightness speed R G B R2 G2 B2 direction rainbow` on output report 1,
  15 effect codes, brightness and speed 0–4, and 8 direction codes.
- **[DanielGibson's Pulsar PCMK TKL notes](https://gist.github.com/DanielGibson/cd92c5faa6b2e0426351dc44193c6182)**
  (no licence beyond the hidraw sample; facts only). Same lighting packet on `0416:B23C`
  (Nuvoton NUC121), plus:
  - per-key colours: `09 00 00 NN LEN` RGB, 8 packets, 132 LEDs, components up to `0xC1`, then
    effect `0x0A`;
  - logo lighting `08 … 0D`;
  - its effect codes differ from the MK870's from code 4 on.
- **Official FL Esports driver V1.06.16** ("Windows 1-mode: FL980, GP108, MK870 …",
  fl-esports.com). The Inno Setup installer was unpacked and its Qt resources and code read; nothing
  was copied.
  - Its device list names `0416:B23C` (NUC121) and `0416:C345` (M252), so the MK870 and the
    Pulsar PCMK share one protocol.
  - Its default profiles list the 132 matrix positions in order. That fixes every LED and key index,
    including the slots the gist left open (backslash 58, quote 78, Enter 80, Fn 121).
  - Command table, from the app's debug labels:

    | Command    | Use                            |
    | ---------- | ------------------------------ |
    | `01`       | handshake; also the sleep time |
    | `04`, `05` | key reports                    |
    | `06`       | multimedia                     |
    | `07`       | lighting (`07 01` reads it)    |
    | `08`       | side light                     |
    | `09`       | per-key colours                |
    | `0B`       | **firmware updater**           |
    | `13`       | mouse keys                     |
    | `14`       | profile / factory reset        |
    | `15`       | serial number read             |
    | `16`       | **serial number write**        |
    | `17`       | light sync                     |
    | `18`       | key map                        |
    | `19`       | macro list                     |
    | `21`–`26`  | LCD                            |
    | `41`–`46`  | mouse                          |

  - Key map, decoded from the code:
    - `18 LAYER 00 N LEN`, 14 keys of 4 bytes per packet, 10 packets per layer;
    - layers: 0 default, 1 FN1, 2 FN;
    - entries: `00 USAGE 00 00` for a key, `01 00 00 00` for Fn, `07 CODE 00 00` for a media
      key, `13 MOD1 KEY 00` / `13 MOD1 MOD2 KEY` for a key with modifiers;
    - media codes: indices 0–7 match the app's menu (Volume up … Media player) and the Fn rows
      of its profiles; Calculator is `0x32`.
  - Sleep: `01 00 00 00 01 00` with the light-off and keyboard-sleep times in seconds,
    big-endian, at bytes 13–16. The app refuses less than 300 s.
  - Read-only lighting query: `07 01` ("Inquire Keyboard Light Config"). How the app parses its
    answer is not decoded.
- [brainrom/winbond-kbdbl](https://github.com/brainrom/winbond-kbdbl) (MIT): an older Winbond
  generation (`0416:A0F8`, `06 BE` commands), not this protocol.
- OpenRGB requests [#2445](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/2445) (MK870) and
  #3780 / #4116 (Pulsar PCMK): no packets beyond the gist.

**What it changed in OpenKey (`winbond-lighting`):**

- **MK870:** lighting (14 effects, two colours, rainbow, eight directions), per-key colours, the
  default layer's key map, sleep time and key-map restore. All writes are experimental, and the
  keyboard can't report its settings, so OpenKey shows what it last wrote.
- **Pulsar PCMK TKL (`0416:B23C`):** the effects both sources agree on.
- **Never sent:** `0B`, `16` and `22`.
- **Diagnostics:** Device Lab → Report runs the read-only `07 01` check on a click. The diagnostic
  package now has a descriptor fingerprint, a vendor-channel map, family hints, per-adapter match
  reasons, evidence per feature and protocol-check answer shapes. It still carries no payloads.

**Follow-up the same month:**

- **Lighting read-back:** the driver's parser for the `07` answer (0x67F480) reads mode,
  brightness, speed, colour, second colour, direction and rainbow at the positions of the lighting
  write. OpenKey asks once on connection, as the driver does. If this keyboard answers, lighting is
  read back from it and checked after every change; if not, OpenKey shows what it last wrote.
- **Key-map acknowledgement:** the keyboard answers each `18` packet with an echo, which the
  driver handles. OpenKey waits up to 150 ms for it between packets to pace the writes, but does
  not count it as a read-back.
- **Macros:** the driver's onboard macro list (`19 MACRO 00 K LEN`, 5 packets × 10 slots, sent
  with retries) always goes out empty. Macro keys are played by the app itself through key reports
  (`04` six-key, `05` full-key, "Write Key"). There is nothing for OpenKey to store on the keyboard.
- **FN1/FN layers:** the key-map packet takes a layer, but the driver has no key-map read, and the
  layers' factory contents are not in its files. Writing them would erase the Fn functions, so
  OpenKey does not.
- **Music rhythm:** the app streams levels with command `20`; not offered.

### RK R75 RGB (`258A:015E`), the owner's keyboard, October 2026

The owner's support bundle from 11 October predates the `by-tech` adapter. Detection now offers it
for that exact descriptor, after asking once.

[vinc3m1/kludgeknight](https://github.com/vinc3m1/kludgeknight) (GPL-3.0, facts only) was read
again:

- **Protocol does not apply.** Its packets are RK's older 65-byte `0A` reports on a `0001:0080`
  collection. The R75 has neither; it has the BY Tech 519-byte report 6.
- **Configuration facts do apply.** The R75's `Dev/015E/KB.ini` gives:
  - every key's picture position, default key and matrix index (80 keys, the knob as K81);
  - the controls of each lighting effect (`LedOpt1`–`20`, no 18);
  - the default effect (10).
- **Effect names stay unknown.** RK's shared `led.xml` names do not fit the R75's flags (effect 2
  has a speed control but is "Customize" there), so OpenKey numbers the effects.

**What it changed:** the R75 now shows its own keyboard and knob, and only its own effects with the
right controls. The settings-page layout is still learned from two key presses, with nothing written.

## AJAZZ mice

**AJ139 V2 MC** — [Ripariav/Ajazz-AJ139V2MC-Linux-Driver](https://github.com/Ripariav/Ajazz-AJ139V2MC-Linux-Driver)
(MIT); protocol captured from the vendor's web configurator.

| Fact                     | Value                                                      |
| ------------------------ | ---------------------------------------------------------- |
| USB IDs                  | `A8A4:2255` (cable), `A8A5:2255` (receiver)                |
| Interface                | FF01, 64-byte output/input reports                         |
| Live settings read       | `55 0e a5 0b …`                                            |
| Settings write           | `55 0f ae …`, replaces the whole block                     |
| Debounce                 | byte 51, in ms                                             |
| Polling rate             | byte 10, index into 125–2000 Hz                            |
| DPI                      | bytes 11–24: count, active level, six little-endian levels |
| Sleep / wake-up / scroll | bytes 52, 54 and 48                                        |
| Battery                  | `55 30 …`, byte 8                                          |

Cable and receiver keep separate settings.

- The source warns that writing the block from defaults resets everything else. OpenKey writes only
  as read-modify-write of the block it just read, and verifies the reply and a fresh read.
- The debounce range is not documented (factory value 4 ms), so OpenKey offers 1–20 ms.

Other sources: nico2525nn/AjazzAJ139V2 (no licence) and cheesyserg/ajazz-aj139-v2-mc-driver (GPL-3.0)
were not used.

**AJ179** — [Rockeyxx/aj179-linux](https://github.com/Rockeyxx/aj179-linux) (MIT) documents a different
protocol: `249A:5C2F` receiver and `248A:5C2E` cable, 32-byte reports with a checksum, and
`button_respond_time` (debounce) in the `0x17` read. It is a separate adapter for later.

## Review of 2026-10-17: new adapters and limitations

Licences re-checked from each repository's LICENSE file on 2026-10-17. Two guide entries were wrong
and are corrected: `dantje/ajazz-ak35i-v3-max` is **MIT** (was "NOASSERTION"), and
`AuRoN89/AULA-F108-PRO-Reverse-Engineering` is **CC-BY-4.0**. As before, OpenKey's adapters are its own
TypeScript: MIT and Apache sources were read closely and their facts re-implemented with credit; GPL
sources (openrazer, OpenRGB, Solaar, somenever, thanks4opensource) are used for **facts only**.

### Standards and vendor SDKs

| Project                                                                      | Licence              | Depth | What OpenKey uses                                                                                                                                                                                                                                                                                                    | Not used                                                                        |
| ---------------------------------------------------------------------------- | -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| USB-IF HID Usage Tables, Lighting And Illumination page (0x59)               | public specification | read  | The **hid-lamparray** adapter: six reports found by their logical collection (not by ID), lamp attributes read from the keyboard (position, purpose, levels, key binding) to build the layout, multi/range updates, autonomous mode to give the lighting back. Microsoft's reference descriptor is parsed in a test. | Devices with non-standard field widths are refused rather than guessed.         |
| [OpenRGB HIDLampArrayController](https://gitlab.com/CalcProgrammer1/OpenRGB) | GPL-2.0              | read  | Cross-check of field order and report discovery on real devices.                                                                                                                                                                                                                                                     | No code.                                                                        |
| [WootingKb/wooting-rgb-sdk](https://github.com/WootingKb/wooting-rgb-sdk)    | MPL-2.0              | read  | The **wooting-rgb** adapter: configuration pages 0x1337/0xFF55, `D0 DA` feature commands (19 device config, 33 colour init, 32 reset all), the 6 × 21 RGB565 colour report, 64-byte split on ARM boards, report 5 on v3, the model table with gamepad-driver PIDs.                                                   | Analog, actuation and profile protocols are not public: they stay in Wootility. |

### Brands documented by OpenRGB / openrazer / Solaar (facts only)

| Project                                                                                           | Licence | Depth | What OpenKey uses                                                                                                                                                                                                      | Not used                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [openrazer](https://github.com/openrazer/openrazer) `driver/`                                     | GPL-2.0 | read  | **razer-chroma**: 90-byte report, status codes, XOR checksum, standard (class 03) and extended (class 0F) effect, brightness and custom-frame commands, firmware read.                                                 | Device-mode and profile commands are never sent.                                                                                                                         |
| OpenRGB `RazerController`                                                                         | GPL-2.0 | read  | The model table (PID, command set, transaction id, LED matrix): 52 keyboards after dropping the Bluetooth entry OpenRGB itself leaves disabled.                                                                        | Custom/linear/ARGB matrix types (3 devices) are left out.                                                                                                                |
| OpenRGB `EVisionKeyboardController`                                                               | GPL-2.0 | read  | **evision**: report 4, 16-bit sum checksum, parameter block, 0x11 colour table and the 126-LED full-size map; the vendor's own effect names.                                                                           | The 0x10 colour **read** exists but is not used (not exercised by any tool).                                                                                             |
| OpenRGB `A4TechController/BloodyB820R`, `HyperXAlloyOriginsController`, `DuckyKeyboardController` | GPL-2.0 | read  | **bloody-b820r**, **hyperx-alloy-origins**, **ducky-rgb**: direct-mode frames and LED orders.                                                                                                                          | HyperX and Ducky have no "give back" command in OpenRGB, so OpenKey does not invent one: it says to unplug.                                                              |
| OpenRGB `SteelSeriesController`                                                                   | GPL-2.0 | read  | **steelseries-apex**: firmware read, generation per model and from firmware ≥ 1.19.7, init/on-board commands, usage-addressed direct frames.                                                                           | Brightness command is documented but not wired into the UI yet; OLED and actuation are not touched.                                                                      |
| OpenRGB `LogitechController`, [Solaar](https://github.com/pwr-Solaar/Solaar)                      | GPL-2.0 | read  | **logitech-hidpp**: HID++ 2.0 long reports, root ping and getFeature (so no hard-coded feature indices), device name, unified battery, `setSWControl` take/give-back, on-board host mode, per-key zones and frame end. | OpenRGB's calls to feature 0x4522 ("keyboard disable by usage") are not copied: unrelated to lighting. Zone-only devices (0x8071 without 0x8081) are not configured yet. |
| OpenRGB `CorsairPeripheralV2Controller`                                                           | GPL-2.0 | read  | Researched: Bragi-style commands, transactions, R/G/B plane writes, LED values = HID usages with a modifier table.                                                                                                     | **Not implemented**: software lighting reverts after ~30 s without a keep-alive and the K100 needs its own lighting endpoint. Planned with a keep-alive.                 |

### Community projects (AJAZZ, AULA, RK)

| Project                                                                                             | Licence    | Depth   | What OpenKey uses                                                                                                                                                                                                                                                                                  | Not used                                                                                              |
| --------------------------------------------------------------------------------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Rockeyxx/aj179-linux](https://github.com/Rockeyxx/aj179-linux)                                     | MIT        | read    | **aj179-mouse**: framing and checksum, status codes (asleep / no answer), every read and write with read-back, the two-write mode change, DPI codecs per sensor, sleep steps, debounce range. The vendor's DPI decoder is off by one above 26 000 DPI on sensor 0x96: OpenKey shows what it wrote. | Macros and button mapping (no read-back), the resets and the firmware updater.                        |
| [J0hnBloodborne/rea-jazz](https://github.com/J0hnBloodborne/rea-jazz)                               | MIT        | read    | **semico-lighting** (AK992): feature report 7, mode packet, mode/level ranges from the firmware parser, the 1 s rate limit (EEPROM), the `EE` firmware-update prefix (refused).                                                                                                                    | Per-key and music commands (tested by the source: no effect).                                         |
| [Dylan-1107/aula-f87s-hid](https://github.com/Dylan-1107/aula-f87s-hid)                             | MIT        | read    | **hub-aa55**: `AA`/`55` framing with offset and last flag, device info, effect block (brightness must stay ≤ 5), 128-slot table written whole with unused slots kept, 87-key LED map, receiver body-ID check, the forbidden list.                                                                  | The 0x08 real-time channel (unproven by the source), zone lights.                                     |
| [10ishk/ak680-studio](https://github.com/10ishk/ak680-studio)                                       | Apache-2.0 | read    | Confirms the same family on the AK680 V2 (`AA 10 30` info, `AA 23 10` lighting, official profile field set).                                                                                                                                                                                       | Actuation writes: not yet with read-back.                                                             |
| [somenever/not-ajazz-ak680-max-webhid](https://github.com/somenever/not-ajazz-ak680-max-webhid)     | GPL-3.0    | read    | Facts: AK680 MAX PIDs, 32-byte framing; the lightless AK680 MAX is a ROYUAN board (`3151:502C`).                                                                                                                                                                                                   | No code.                                                                                              |
| [parsiya/f108-pro](https://github.com/parsiya/f108-pro)                                             | MIT        | read    | **F108 Pro** profile on the verified AJAZZ protocol: product string, 104-key table, 240 × 135 screen, the **141-frame cap** (a 214-frame upload overwrote the menu graphics), the warning never to SET_REPORT pages on the data interface (OpenKey uses output reports).                           | The 2.4 GHz single-packet protocol.                                                                   |
| [dantje/ajazz-ak35i-v3-max](https://github.com/dantje/ajazz-ak35i-v3-max)                           | MIT        | read    | AK35i V3 MAX is the same protocol with the generic name "USB KEYBOARD" and a 240 × 135 screen; this is why unrecognised boards now **choose** their screen size instead of getting 128 × 128. Its `05`/`12` reads are documented only for this model and are not sent elsewhere.                   | —                                                                                                     |
| [aar-rafi/aks075-linux](https://github.com/aar-rafi/aks075-linux)                                   | MIT        | read    | AKS075 = AK820 MAX geometry (128 × 128, 255 frames).                                                                                                                                                                                                                                               | —                                                                                                     |
| [ElXreno/rk-m87-sync](https://github.com/ElXreno/rk-m87-sync)                                       | MIT        | read    | The M87 is on the BY Tech (CDevG5KB) platform: model code `06 … 23`, `SetScreenParam` 0x0B for the clock. Cable and receiver command numbers differ.                                                                                                                                               | Picture upload (screen controller with its own checksums, not tested by the source) and the receiver. |
| [Lightning-13/rk-m75](https://github.com/Lightning-13/rk-m75)                                       | MIT        | read    | The M75 (`258A:0163`, report 9 × 520) is CDevG5KB too: OpenKey treats it as a BY Tech board to teach.                                                                                                                                                                                              | Live colour streaming (fades after ~1 s without a keep-alive).                                        |
| [witchbladeq/AULA-F99-PRO-OpenRGB](https://github.com/witchbladeq/AULA-F99-PRO-OpenRGB)             | MIT        | read    | New evidence for receiver writes (`04` write, `0A` save, apply flag).                                                                                                                                                                                                                              | Still disagrees with the RK decompile on the save step: the receiver stays read-only.                 |
| [thanks4opensource/NotLinuxAjazzAK33RGB](https://github.com/thanks4opensource/NotLinuxAjazzAK33RGB) | GPL-3.0    | skimmed | —                                                                                                                                                                                                                                                                                                  | The AK33's USB identity and descriptors are not published; no adapter until a diagnostic arrives.     |
