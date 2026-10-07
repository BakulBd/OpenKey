# Compatibility matrix

Only verified information. Legend: ✅ confirmed on hardware · 🟦 implemented from official code, not yet
hardware-tested · 🟨 community-documented / experimental · ⬜ not available on this model/link · ❔ unknown.
"Read" columns say whether the keyboard can report the setting (the Windows-protocol firmware is write-only
for most settings; OpenKey then shows what it last wrote).

| Device                                         | VID             | PID             | Firmware             | Protocol                      | USB                                   | 2.4 GHz                                | BT                           | Device info        | Keymap / Fn             | RGB             | Per-key RGB        | Macros        | TFT                                   | Settings                              |
| ---------------------------------------------- | --------------- | --------------- | -------------------- | ----------------------------- | ------------------------------------- | -------------------------------------- | ---------------------------- | ------------------ | ----------------------- | --------------- | ------------------ | ------------- | ------------------------------------- | ------------------------------------- |
| AK820 MAX / MAX PLUS TFT ("AK820 MAX")         | 0x0C45          | 0x8009 (0x800A) | 1.07 (bcdDevice)     | sonix-feature                 | ✅ detection, handshake, per-key read | 🟨 receiver protocol known, not tested | ⬜ (official: not supported) | ✅ USB identity    | 🟦 write (read: mirror) | 🟦 write        | ✅ read · 🟦 write | 🟦 write      | 🟦 image/GIF/clock                    | 🟦 sleep, key response, Win/Alt locks |
| AK820 Pro, Windows-protocol firmware ("AK820") | 0x0C45          | 0x8009 / 0x800A | ❔                   | sonix-feature                 | 🟦                                    | 🟨                                     | ⬜                           | 🟦                 | 🟦                      | 🟦              | 🟦                 | 🟦            | 🟦 (≤140 frames)                      | 🟦                                    |
| AK820 Pro, online-driver firmware ("AK820")    | 0x0C45          | 0x8009          | ❔ (reports its own) | sonix-aa55                    | 🟦                                    | ❔                                     | ⬜                           | 🟦 read            | 🟦 read/write           | 🟦 read/write   | 🟦 read/write      | 🟦 read/write | 🟨 experimental                       | 🟦 game mode, sleep                   |
| AK820 MAX HE (NACODEX)                         | 0x0C45          | 0x80B1          | ❔                   | sonix-aa55 (descriptor match) | 🟨                                    | ❔                                     | ❔                           | 🟨                 | 🟨                      | 🟨              | 🟨                 | 🟨            | ❔                                    | 🟨                                    |
| AK820 2.4 GHz receiver                         | 0x0C45 / 0x05AC | 0xFDFD / 0x024F | ❔                   | sonix-dongle                  | ⬜                                    | 🟨 detection + ping                    | ⬜                           | 🟨                 | ⬜                      | 🟨 experimental | ⬜                 | ⬜            | ⬜ (official: no screen over 2.4 GHz) | ⬜                                    |
| AK820 Max Plus, CRS controller                 | 0x1A2C          | 0xA036 / 0x8FFF | ❔                   | crs-aa55cc33                  | 🟨                                    | 🟨                                     | ⬜                           | 🟨                 | ⬜                      | 🟨 experimental | 🟨 experimental    | ⬜            | ⬜                                    | ⬜                                    |
| AK820 Pro with community QMK                   | 0x0C45          | 0x8009          | QMK                  | qmk-via                       | identification only (use VIA)         | ❔                                     | ❔                           | ✅ via VIA version | —                       | —               | —                  | —             | —                                     | —                                     |
| AK820 MAX, SinoWealth MCU                      | 0x258A          | 0x010C          | ❔                   | not supported                 | ⬜                                    | ⬜                                     | ⬜                           | ⬜                 | ⬜                      | ⬜              | ⬜                 | ⬜            | ⬜                                    | ⬜                                    |

Knob: not configurable on any Sonix AK820 model through the official software (no wheel/knob mapping in
the Windows driver; `wheelKeys` empty for the AK820 Pro in the online driver).

Polling rate, game mode: not offered by the official Windows-protocol driver; available through the
online-driver game-mode struct only.

## Transports on the AK820 MAX PLUS

| Link      | Identity seen                              | Configuration                   | Evidence                                     |
| --------- | ------------------------------------------ | ------------------------------- | -------------------------------------------- |
| USB cable | 0C45:8009 "AK820 MAX" with FF13 + FF68     | Supported                       | hardware                                     |
| 2.4 GHz   | receiver 05AC:024F or 0C45:FDFD            | Partially supported (no screen) | official config.xml, menu_wireless           |
| Bluetooth | 0C45:FEFE observed on this machine earlier | Not supported                   | official message 62; no vendor pipe expected |
