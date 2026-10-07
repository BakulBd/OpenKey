# Official driver analysis

How the `sonix-feature` protocol was recovered, so anyone can reproduce or extend it. No AJAZZ file
is stored in this repository; download the packages from AJAZZ yourself.

## 1. Find the right package

The AJAZZ download page (`a-jazz.com/en/h-col-159.html`) lists "AJAZZ_AK820 MAX&MAX PLUS_Tri-mode_RGB_0.85in
ColorScreen_Keyboard Driver_V1.0.0.5" in six SKU variants; their zips are byte-identical
(MD5 `b7b1ba1689f13bf9d8433e58a3e3bcac`). The Inno Setup installer unpacks with `innoextract`:

```
app/config.xml               device table: vid 0C45 pid 8009/800A product "AK820 MAX"; dongles 05AC:024F, 0C45:FDFD
app/layouts/rgb-keyboard.xml menus, cmd_delaytime 35, screen 128×128 gif_maxframes 255 gif_count 1, key table
app/language/1033.lan        UTF-16 UI strings (effect names, settings labels, "settings not supported in Bluetooth mode")
app/DeviceDriver.exe         MSVC x86 MFC application
```

The online driver (`ajazz.driveall.cn`) was checked as well: its config table has no
`3141-32777-AK820 MAX` entry, so the online driver does not support this keyboard.

## 2. Locate the HID primitives

`DeviceDriver.exe` loads `hid.dll` dynamically (`HidD_SetFeature`, `HidD_GetFeature` …) and calls
`DeviceIoControl(IOCTL_HID_GET_FEATURE = 0xB0192)` directly. Searching `.text` for that constant leads to
the transfer layer:

| Address                 | Role                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `0x4514e0`              | GET_FEATURE ioctl wrapper                                                                        |
| `0x451440`              | SET_FEATURE wrapper                                                                              |
| `0x451220` / `0x451300` | WriteFile / ReadFile (overlapped, 300 ms)                                                        |
| `0x44eed0`              | send packet (sleep 35 ms, SET, optional GET handshake checking byte 3 == 1; multi-packet writes) |
| `0x44f0c0`              | as above, retries on byte 3 == 0xFF                                                              |
| `0x44f3a0`              | read table: command, ack, N × 64-byte GET                                                        |
| `0x44f2d0`              | 4096-byte data chunk + input read                                                                |
| `0x44f5f0`              | 2.4 GHz 32-byte packet with checksum                                                             |

## 3. Enumerate commands

Every command buffer is initialised with a 16-bit immediate store `mov word [buf], 0xCC04`
(little endian `04 CC`). A linear sweep for such stores finds all commands: `18 02 F0 13 17 28 72 20 23 15 19 F5 2B`
(the last being key data, not a command). Each call site was followed to its function and the
neighbouring byte stores, combo-box item data and UI string IDs were used to name each field. The
results are in [`docs/protocol/sonix-feature.md`](../protocol/sonix-feature.md).

Tooling used: Python with `pefile` + `capstone` for disassembly with import and string annotation.
Ghidra produces the same view if you prefer a decompiler.

## 4. Verify on hardware

Only read/handshake commands were sent to the test unit so far (with the owner's consent):

1. passive GET_FEATURE → all zero after power-up, echo of the last command later;
2. `04 18` START → `04 18 00 01`;
3. `04 F5 … 09` → ack `04 F5 00 01 … 09`, then 9 packets of `[index, R, G, B]` entries; followed by `04 02` SAVE → `04 02 00 01`.

The raw packets are in `fixtures/*-hw.json` and replayed by `tests/device/hardware-replay.test.ts`.
