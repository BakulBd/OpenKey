# AULA F99 family: research and integration

Status on 2026-10-12. Every claim below names its source. Nothing in this document was run on an
F99 by OpenKey; the F99 has no hardware-verified identity yet.

## 1. Model-by-model compatibility

The F99, F99 Pro and F99 Max are treated as separate products. The USB ID is the same for every
AULA keyboard on the BY Tech platform (`258A:010C` by cable, `3554:FA09` through the receiver), so the
model is identified by the **model code** the keyboard returns, never by the USB ID or the name.

| Model     | Model code          | Cable `258A:010C`                                                                               | 2.4 GHz receiver `3554:FA09`                     | Bluetooth                | OpenKey adapter            |
| --------- | ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------ | -------------------------- |
| F99       | `03 00 00 00 00 A4` | Lighting effect, colour, brightness, speed, sleep (read-modify-write, read back). Experimental. | Identification, battery, lighting **read-only**. | No configuration channel | `by-tech`, `aula-receiver` |
| F99 Pro   | `03 00 00 00 01 58` | Same as F99. Experimental.                                                                      | Same as F99, read-only.                          | No configuration channel | `by-tech`, `aula-receiver` |
| F99 Wired | `03 00 00 00 00 9A` | Same as F99. Experimental.                                                                      | — (wired only)                                   | —                        | `by-tech`                  |
| F99 Max   | unknown             | **Not assumed.** No public source.                                                              | **Not assumed.**                                 | —                        | none; inspect and report   |

Key maps, macros and per-key colours are **not written** for any F99 yet (see §4).

Model codes: leisiji/AulaSofwareLinux model table and vendor profiles; the F99 code is also returned
by the receiver's model query (pradyumnac: response byte 10 = `A4`), and the F99 Pro code by the
receiver identity command (dnviti: PSD `03,00,00,00,01,58`). Two or three independent sources agree on
each code.

## 2. Transports

### Cable (`258A:010C`)

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Collection     | vendor `FF00:0001` (WebHID: interface 1)                                                                                         |
| Command report | feature report ID 6, 519 bytes after the ID (ID 9 on firmware id ≠ 0x18)                                                         |
| Framing        | `cmd param 0 packages index lenLE payload(≤512)`; a read is SET then GET on the same ID                                          |
| Commands used  | `82 01` identity (read), `84` settings page (read), `04` settings page (write, patched bytes only)                               |
| Evidence       | leisiji/AulaSofwareLinux — verified on an AULA F75 (identity, lighting, sleep); aula-keybind — key-map write on an F87 (Windows) |

dnviti/aula-x99-pro-driver-linux states the cable "only supports identification". Its cable code sends a
bare `04` (the settings-page **write** opcode) as a handshake, which explains the failure; leisiji's
framing is the one verified on hardware, and OpenKey uses it.

### 2.4 GHz receiver (`3554:FA09`)

|               |                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Collection    | vendor `FF02:0002`                                                                                                                |
| Reports       | output and input, report ID `0x13`, 19 bytes after the ID                                                                         |
| Request       | `13 cmd 01 00 … checksum`; checksum = sum of bytes 0..18 (the receiver does not check it; OpenKey sends it)                       |
| Reply         | `13 cmd pages page len data(14) checksum`                                                                                         |
| Commands used | `05` identity, `0B` firmware/battery (reply `0A`), `44` settings page (10 pages)                                                  |
| Evidence      | pradyumnac/aula-f99-controller (framing, checksum, `05`; F99); dnviti (multi-page replies, `0B`, `44`; F99 Pro, live USB traffic) |

The same interface carries media-key, NKRO and mouse input reports; WebHID delivers input reports
without their ID, so OpenKey accepts a reply only when it is 19 bytes long, echoes the command and has
a valid checksum.

### Bluetooth

No source exposes a configuration channel over Bluetooth (pradyumnac: "Bluetooth mode presents no USB
device"). Typing works; OpenKey shows the keyboard in the tester only.

## 3. Sources and licences

| Source                                                                                                                                                                                         | Licence           | Target                                                  | Evidence quality                                                                                                  | Used by OpenKey                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [leisiji/AulaSofwareLinux](https://github.com/leisiji/AulaSofwareLinux)                                                                                                                        | MIT               | F75 (verified), F87, F99, F99 Pro, H108 (same firmware) | Hardware-verified on F75: identity, lighting page offsets (confirmed by pressing Fn+Tab and diffing reads), sleep | Cable framing, identity, settings page layout, model table, F75 page capture (test data) |
| [pradyumnac/aula-f99-controller](https://github.com/pradyumnac/aula-f99-controller)                                                                                                            | MIT               | **F99**                                                 | Receiver commands `05` and `88` on hardware (Windows); 18 unit tests; cable writes fail                           | Receiver framing, checksum, identity request                                             |
| [dnviti/aula-x99-pro-driver-linux](https://github.com/dnviti/aula-x99-pro-driver-linux)                                                                                                        | none (facts only) | **F99 Pro**                                             | Live USB traffic for receiver reads; write offsets unconfirmed and contradict the verified cable layout           | Receiver `0B`, `44`, multi-page format (reads only)                                      |
| [vndarkblue/aula-keybind](https://github.com/vndarkblue/aula-keybind)                                                                                                                          | MIT               | F87 (Windows, wired)                                    | Key-map writes on hardware; read-back unreliable on most firmwares (seeds from a factory template)                | Cross-check of the key-map framing; not implemented (§4)                                 |
| [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver)                                                                                                              | MIT               | F75 **Max** (`0C45:800A`, Sonix)                        | Hardware                                                                                                          | Shows "Max" models can be a different platform; no F99 Max data                          |
| [sgtflixy/AulaControl](https://github.com/sgtflixy/AulaControl)                                                                                                                                | Apache-2.0        | WIN60HE (`2E3C:C365`, Hall effect)                      | Hardware                                                                                                          | Not applicable to the F99 (different protocol family)                                    |
| [cvanelteren/OpenAula](https://github.com/cvanelteren/OpenAula), [veysiemrah/aula-rgb-controller](https://github.com/veysiemrah/aula-rgb-controller)                                           | GPL-3.0           | F75                                                     | Varies                                                                                                            | Not used (GPL; nothing beyond the MIT sources)                                           |
| [cloudglides](https://github.com/cloudglides/aula-f75-linux-drivers), [not-ayan/openaula](https://github.com/not-ayan/openaula), [Le-Maxime](https://github.com/Le-Maxime/Aula-F75-Web-Driver) | none              | F75                                                     | Varies                                                                                                            | Facts cross-checked only                                                                 |
| [Ahorts/aula-f87pro](https://github.com/Ahorts/aula-f87pro)                                                                                                                                    | MIT               | F87 Pro                                                 | Not reviewed in depth                                                                                             | —                                                                                        |

No code was copied. OpenKey's adapters re-implement the facts in TypeScript; MIT sources are credited in
THIRD_PARTY.md and in each adapter's manifest.

## 4. What is deliberately not implemented

| Feature                                   | Why not yet                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key maps (cable)                          | Framing agrees between leisiji and aula-keybind (`03`, layer in byte 2, 128 × 4-byte slots), but they disagree on the trailer position, and aula-keybind reports that the table cannot be read back on most firmwares. A write without a read would replace the user's bindings with a template. Needs one capture of the official software on an F99. |
| Any write through the receiver            | dnviti's write opcodes (`01`–`04`, `09`) overlap the opcodes it also calls "apply" and "reset to defaults", and its page offsets contradict the verified cable layout.                                                                                                                                                                                 |
| Per-key colours, macros                   | Need the F99's LED index map (from its `KB.ini`) and a verified write.                                                                                                                                                                                                                                                                                 |
| Factory reset (`11` cable, `02` receiver) | Destructive; never sent.                                                                                                                                                                                                                                                                                                                               |
| Firmware update                           | Out of scope.                                                                                                                                                                                                                                                                                                                                          |

## 5. Adapter design (implemented)

- `by-tech` (cable): match feature report 6/9 of 519 bytes; consent-gated identity read `82 01`;
  model from the code table; lighting/sleep by read → patch → write → read back; anything not in the
  model table stays read-only until the owner teaches the layout with the keyboard's own shortcuts.
- `aula-receiver` (receiver): match report `0x13` (19 B) in both directions; consent-gated identity
  `05`; firmware/battery `0B`; settings page `44` decoded with the cable layout; read-only. The request
  builder refuses `01`–`04` and `09`.

## 6. Regression tests

`tests/protocol/by-tech.test.ts`, `tests/protocol/aula-receiver.test.ts` and the conformance kit cover:

- identity request bytes match the published packets (`06 82 01 00 01 00 06 00`; `13 05 01 00 … ck`);
- nothing is sent before consent; only declared operations are sent after it;
- a 19-byte reply is accepted only with the right command and checksum, and media-key reports on the
  same interface are skipped;
- model codes `A4` → F99, `01 58` → F99 Pro, `CD` → F75, via one table for both transports;
- the settings page is decoded identically over the cable and through the receiver;
- write, apply and reset opcodes are refused by the builders;
- an F99-shaped device that answers nothing gets no driver.

## 7. Hardware tests still required (owner consent, one at a time)

1. F99 by cable: identity read returns `03 00 00 00 00 A4`; settings page read has the `5A A5` marker.
2. F99 by cable: change the effect with Fn+Tab, read again — only offset `0x0A` / the slot changes
   (confirms the F75 layout on the F99).
3. F99 by cable: one lighting write from OpenKey, read back, visible on the keyboard.
4. F99 Pro: steps 1–3 with code `01 58`.
5. Receiver with F99 and F99 Pro: identity, battery, settings page match the cable read.
6. Capture of the official software writing one key map on an F99 (needed before key maps).
7. F99 Max: a diagnostic package (descriptors only) to learn its platform.
