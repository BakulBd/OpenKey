# `sonix-feature`: AJAZZ Windows-driver protocol

Used by the AJAZZ AK820 MAX / MAX PLUS (TFT) and by AK820 Pro units whose firmware exposes the same
HID topology. Reimplemented from the official driver
"AK820 MAX&MAX PLUS Tri-mode RGB 0.85in ColorScreen" V1.0.0.5 (`DeviceDriver.exe`, MSVC x86, image
base `0x400000`; function names below are its addresses) and verified on the hardware where noted.

Confidence levels: **CONFIRMED** = observed on the AK820 MAX PLUS test unit (bcdDevice 1.07);
**STRONGLY_SUPPORTED** = traced byte-for-byte in the official driver, not yet exercised on hardware;
**INFERRED** = reasoned, single source.

## Transport

| Item                | Value                                                                                                                    | Evidence                                              | Confidence          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------- |
| Control pipe        | Vendor collection usage page `0xFF13`, usage `0x01`; 64-byte input, output and **feature** report; no report IDs         | report descriptor, `FUN_0044edc0`…                    | CONFIRMED           |
| Data pipe           | Usage page `0xFF68`, usage `0x61`; 64-byte input, **4096-byte output**; no report IDs; interrupt OUT EP 0x03, IN EP 0x84 | report descriptor, `lsusb`                            | CONFIRMED           |
| Report ID           | 0 (Windows buffer `[0x00, payload…]` of 65 bytes)                                                                        | `FUN_0044eed0`                                        | CONFIRMED           |
| Command transfer    | `HidD_SetFeature` with 64-byte payload                                                                                   | `FUN_00451440`                                        | CONFIRMED           |
| Acknowledgement     | `IOCTL_HID_GET_FEATURE` (`0xB0192`) returns the last packet with **payload[3] = 0x01**                                   | `FUN_0044eed0` checks byte 3; hardware: `04 18 00 01` | CONFIRMED           |
| Busy                | payload[3] = `0xFF` → retry once                                                                                         | `FUN_0044f0c0`                                        | STRONGLY_SUPPORTED  |
| Pacing              | sleep `cmd_delaytime` = **35 ms** before each SET and before each GET                                                    | `layouts/rgb-keyboard.xml`, `FUN_0044eed0`            | STRONGLY_SUPPORTED  |
| Multi-packet writes | consecutive 64-byte feature reports, no per-packet handshake; a failed SET is retried up to 10 times                     | `FUN_0044eed0`                                        | STRONGLY_SUPPORTED  |
| Data chunks         | 4096-byte output report on FF68, then wait ≤300 ms for one 64-byte input report (content ignored)                        | `FUN_0044f2d0`, `FUN_004511f0`                        | STRONGLY_SUPPORTED  |
| Linux note          | hidraw strips a leading `0x00`; always write `[reportId, …payload]`                                                      | aks075-linux                                          | CONFIRMED (sibling) |
| Passive read        | GET_FEATURE without a prior command returns the echo of the last command (all zero after power-up)                       | hardware                                              | CONFIRMED           |

There is **no device-information command**. The official driver identifies the keyboard only by
VID, PID, USB product string and HID topology, and it never reads keymaps, macros or settings back.

## Command packet

```
offset  0    1    2    3..7   8     9     10..63
        04   cmd  sub  00     arg8  arg9  00
```

| cmd  | Name             | Sequence (H = handshake read)                                           | Evidence                       | Confidence               |
| ---- | ---------------- | ----------------------------------------------------------------------- | ------------------------------ | ------------------------ |
| `18` | START            | opens a configuration transaction (H)                                   | all write functions            | CONFIRMED (ack observed) |
| `02` | SAVE             | commits to flash (H)                                                    | all write functions            | CONFIRMED (ack observed) |
| `F0` | FINISH           | ends lighting/keymap transactions                                       | `FUN_0042b100`, `FUN_00418420` | STRONGLY_SUPPORTED       |
| `13` | LIGHT_MODE       | `arg8=01`, then lighting data packet                                    | `FUN_0042b100`                 | STRONGLY_SUPPORTED       |
| `23` | PER_KEY_RGB      | `arg8=09`, then 576-byte table                                          | `FUN_0044ba10`                 | STRONGLY_SUPPORTED       |
| `F5` | READ_PER_KEY_RGB | `arg8=09`, ack, then 9 × GET_FEATURE                                    | `FUN_0042aee0`, `FUN_0044f3a0` | CONFIRMED                |
| `20` | REALTIME_RGB     | `arg8=08`, 512-byte packed table, then `02`                             | `FUN_004329e0`                 | STRONGLY_SUPPORTED       |
| `11` | KEYMAP_BASE      | `arg8=09`, 576-byte table                                               | `FUN_00418420(0)`              | STRONGLY_SUPPORTED       |
| `27` | KEYMAP_FN        | `arg8=09`, 576-byte table                                               | `FUN_00418420(1)`              | STRONGLY_SUPPORTED       |
| `19` | MACRO_BEGIN      | sent instead of START before macros (H)                                 | `FUN_0042d6f0`                 | STRONGLY_SUPPORTED       |
| `15` | MACRO_DATA       | `arg8=packets`, storage image                                           | `FUN_0042d6f0`                 | STRONGLY_SUPPORTED       |
| `17` | SETTINGS         | `sub=01 arg8=01`, then settings data packet                             | `FUN_00414060`                 | STRONGLY_SUPPORTED       |
| `28` | TIME             | `arg8=01`, then clock data packet (H)                                   | `FUN_00423940`                 | STRONGLY_SUPPORTED       |
| `72` | IMAGE            | `sub=slot`, `arg8..9 = chunk count` (u16 LE), then chunks on FF68       | `FUN_00422980`                 | STRONGLY_SUPPORTED       |
| `2B` | —                | appears only as data (`Alt+Tab` = `04 2B` in a key slot), not a command | `FUN_00418070`                 | n/a                      |

Data packets are plain 64-byte feature reports that do **not** start with `04`.

## Transactions

| Operation       | Packets                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Lighting        | `START`(H) · `13 arg8=1`(H) · data · `SAVE`(H) · `FINISH`                                                                              |
| Per-key colours | lighting transaction with data `[80 00 …]` (effect 0x80 = per-key) · `START`(H) · `23 arg8=9`(H) · 9 packets · `SAVE`(H) · `FINISH`(H) |
| Per-key read    | `F5 arg8=9` · ack · 9 × read · `SAVE`(H)                                                                                               |
| Keymap          | `START`(H) · `11`/`27 arg8=9`(H) · 9 packets · `SAVE`(H) · `FINISH`(H)                                                                 |
| Macros          | `19`(H) · `15 arg8=n`(H) · 30 ms · n packets · 30 ms · `SAVE`(H)                                                                       |
| Settings        | `START`(H) · `17 01 … arg8=1`(H) · data · `SAVE`(H)                                                                                    |
| Clock           | `START`(H) · `28 arg8=1`(H) · data(H) · `SAVE`(H)                                                                                      |
| TFT             | `START`(H) · `72 slot … chunks`(H) · chunks on FF68 each followed by an input read · `SAVE`(H). **No FINISH.**                         |

## Lighting data (`FUN_0042b100`)

```
0 effect  1 R  2 G  3 B  4..7 0  8 colorful  9 brightness  10 speed  11 direction  12..13 0  14 AA  15 55
```

Effects (official name table, language ids 521–540): 0 LED off, 1 Static, 2 Single On, 3 Single Off,
4 Glittering, 5 Falling, 6 Colourful, 7 Breath, 8 Spectrum, 9 Outward, 10 Scrolling, 11 Rolling,
12 Rotating, 13 Explode, 14 Launch, 15 Ripples, 16 Flowing, 17 Pulsating, 18 Tilt, 19 Shuttle;
0x80 = per-key table. Brightness and speed 0–5 (`brightness_max`, `speed_max`). Direction:
left 0, right 1, up 2, down 3 (radio wiring in the light page). STRONGLY_SUPPORTED.

## Tables: keymap, per-key colours

Both are 576 bytes = 144 four-byte entries, sent as 9 packets, with `AA 55` at offsets 574–575.
The entry index is the **key-matrix slot** `row × 18 + column` from the official key table
(Esc = 1, `` ` `` = 19, Tab = 37, Caps = 55, LShift = 73, LCtrl = 91; highest used slot 121).

Per-key entry: `[index, R, G, B]`. The read-back from hardware carries `index` in every one of the
144 entries and has no trailer (CONFIRMED; fixture `rgb/ak820-max-plus-read-per-key-hw.json`).

Key slot (`FUN_00418070`):

| Bytes                  | Meaning                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `00 00 00 00`          | firmware default                                                                   |
| `02 mods usage 00`     | HID keyboard usage with modifier bitmask; a bare modifier key is `02 bit 00 00`    |
| `03 lo hi 00`          | consumer usage (e.g. `03 CD 00 00` play/pause)                                     |
| `01 01 mask 00`        | mouse button: 1 left, 2 right, 4 middle, 8 back, 16 forward, 3 = UI "double click" |
| `01 03 01/FF 00`       | mouse wheel up / down                                                              |
| `06 index mode repeat` | play macro (mode byte numbering INFERRED from the online driver)                   |
| `05 03 00 00`          | disable key                                                                        |
| `05 02 value 00`       | vendor function (UI types 8–11)                                                    |
| `07 a b c`             | multi-key (preserved as raw)                                                       |

## Macro storage (`FUN_0042d6f0`)

- index: 100 × u32 at offset 0; listed macros get a u16 offset (≥ 400), listed-but-empty macros
  `FFFFFFFF`, slots past the list stay 0.
- block: 8-byte header (`u16` entry count), then 4-byte entries:
  key `[00 00 usage B0|30]`, mouse `[00 00 1|4|2 90|10]`, delay `[ms lo, ms hi, 00, 50]` (each event
  is followed by its delay, minimum 10 ms).
- packets = ⌊size/64⌋ + (size mod 64 ? 2 : 1); the image ends with `AA 55`.
- capacity check: events × 8 ≤ 0xA8C.
- Macro key events use HID usages; modifiers as `E0`–`E7`; media keys map to `E8`–`F9` (`FUN_00451570`).

## Settings data (`FUN_00414060`)

```
0 00  1 01  2 disable Alt+Tab  3 disable Alt+F4  4 disable Win  5 fn_switch  6 sleep  7 00  8 key response  … 62 AA  63 55
```

Sleep: 0 never, 1 = 1 min, 2 = 5 min, 3 = 30 min. Key response levels 1–5. STRONGLY_SUPPORTED.
(The Pro tools put sleep at byte 8 – that layout is wrong for this firmware.)

## Clock data (`FUN_00423940`)

```
0 00  1 slot  2 5A  3 year−2000  4 month  5 day  6 hour  7 minute  8 second  9 00  10 weekday (0 = Sunday)  … 62 AA  63 55
```

## TFT (`FUN_00422980`)

- 128 × 128, RGB565 little endian, row-major (`GetImageRGB565Data`).
- payload = 256-byte header (`0xFF` filled; `[0]` = frames ≤ 255; `[1+i]` = max(1, delay_i / 2)) +
  frames, padded with `0xFF` to whole 4096-byte chunks.
- `IMAGE` sub-command = slot (list selection + 1); `gif_count = 1` on this model.
- A single frame needs 9 chunks; two frames 17.

## Safety

The driver contains firmware-update code (`FirmwareUpdateTool.exe` download) and reset buttons; none
of their commands are implemented. OpenAK820 only sends the commands in the table above.
