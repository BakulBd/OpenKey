# `sonix-aa55`: AJAZZ online-driver protocol

Reimplemented from the official web driver at https://ajazz.driveall.cn (bundle
`layout-classic-CcyMQaqB.js`, built 2026-09-11). Function names refer to that minified bundle.
Used by AK820 Pro units supported by the online driver and by AK820 MAX HE boards.
**Not hardware-verified by OpenKey** (the test unit belongs to `sonix-feature`); everything here is
STRONGLY_SUPPORTED from official code unless marked INFERRED.

## Selection

The official driver loads a per-model config named `vid-pid-productName` and accepts collections with
usage page FF68, FF80, FF60, FF00, FF01 or FF1B (`B()`). Packet size is
`collections[0].outputReports[0].reportCount` (default 32). OpenKey additionally requires an output
report ≤ 64 bytes and excludes FF60:0061, so QMK raw HID and 4096-byte data pipes (AK820 MAX) are
never treated as AA/55 command pipes.

## Frames (`ht`, `hd`)

```
out: AA cmd len addrLo addrHi opt0 opt1|last opt2 payload…   (packetSize bytes, report ID 0)
in:  55 cmd len addrLo addrHi …      payload from byte 8
```

`ya` splits `contentSize` into `packetSize − 8` byte chunks; chunk _i_ uses `addr = addrStart + i·(packetSize−8)`;
byte 6 = 1 on the last chunk unless `isNeedLastPacketFlag` is false. Each chunk waits for the response
with the same command (500 ms, 3 retries).

## Commands used by OpenKey

| cmd         | Name                                               | Size                |
| ----------- | -------------------------------------------------- | ------------------- |
| 0x10        | GET_DEVICE_INFO                                    | 48                  |
| 0x11 / 0x21 | GET/SET_GAME_MODE                                  | 56                  |
| 0x12 / 0x22 | GET/SET_KEY                                        | 512 (128 slots × 4) |
| 0x16 / 0x26 | GET/SET_FN_KEY                                     | 512                 |
| 0x1C / 0x1F | GET_DEFAULT_FN_KEY_MATRIX / GET_DEFAULT_KEY_MATRIX | 512                 |
| 0x13 / 0x23 | GET/SET_LED_EFFECT                                 | 16                  |
| 0x14 / 0x24 | GET/SET_CUSTOM_LED_DATA                            | 512                 |
| 0x15 / 0x25 | GET/SET_MACRO                                      | index 400 + data    |
| 0x34        | SET_TEMPORARY_COMMAND_DATA (TFT clock)             | 10                  |
| 0x50        | SET_TFT_USER_ANIMATION (FF67 pipe, ack 0x41)       | chunked             |

**Blocked by OpenKey:** 0x0F factory reset, 0x4F flash download, 0x64–0x6A calibration and
simulation tests, 0x80–0x86 OTA (including `OTA_DEVICE_ENTER_BOOT`). The transfer layer throws
`SafetyBlockedError` before anything is sent.

## Device info (`_n`)

`0 romSize · 2–3 macroSpaceSize · 4–5 vid · 6–7 pid · 8–9 version ((b8 & 15) + (b8 >> 4)·10 + b9·100)/100 ·
10–11 sensor · 12–13 manufacturer · 14–15 product · 16 workMode · 17 battery % · 18 charging ·
19 profile · 20–21 axisInfo · 22–23 tftMaxFrames · 24–25 gifMaxFrames · 26–27 ledMaxFrames ·
28 tftDirection · 29 rtPrecision · 30 frameVersion · 31 lightingVersion · 32 firmwareStatus`

The probe confirms the family when the VID/PID fields equal the USB identity.

## LED effect (`Fn`, `zd`)

`0 mode · 1–3 RGB · 4 FF · 5–7 secondary RGB · 8 colorMode · 9 brightness · 10 speed · 11 direction · 12 effectModeType · 14 AA · 15 55`.
Direction codes in this family (left 0, down 1, up 2, right 3) come from community testing: INFERRED.

## Keymap

Slots use the same 4-byte encoding as `sonix-feature` for pages 1 (mouse), 2 (keyboard),
3 (consumer) and 6 (macro), see [`families/common/key-slot.ts`](../../packages/protocols/src/families/common/key-slot.ts).
Slot indices are the online driver's `keyList.value` numbers (Esc = 0, F1 = 1 …), which differ from the
Windows key-matrix indices; the `ak820-pro-online` layout carries them.

## Macros (`Rn`, `ek`)

Index: 100 × u32 offsets (0 = empty) written with the last-packet flag cleared; data from offset 400:
header `[u16 entries×2, 0, 0]`, entries `[delay lo, delay hi, keyCode, flags]` with flags
keyboard `B0`/`30`, mouse `90`/`10`.

## TFT (`ik`)

Payload: 256-byte header (`0xFF` filled, `[0]` = frames, `[1+i]` = UI delay × 5 for i < N−1,
`[N]` = 0) + RGB565 LE frames. Chunk header `AA 50 idxLo idxHi totLo totHi 50 06`, payload
`reportCount − 8` (4096) bytes, response command 0x41. OpenKey converts milliseconds to 2 ms units
(INFERRED) and keeps the upload behind experimental mode until verified.
