# Hardware notes

## AK820 MAX PLUS TFT test unit

| Item        | Value                                                                                                                             | Source              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| USB         | `0C45:8009`, manufacturer "SONiX", product "AK820 MAX", no serial, bcdDevice 1.07, full speed, bus powered 100 mA, remote wake-up | `lsusb -v`          |
| Interface 0 | boot keyboard, EP 0x81 IN, 8-byte report + LED output                                                                             | descriptor          |
| Interface 1 | consumer (ID 3), system (ID 2), NKRO keyboard (ID 1, 120 bits), mouse (ID 6), vendor FFFF (ID 5, 3 B)                             | descriptor          |
| Interface 2 | FF68:0061, input 64 B (EP 0x84), output 4096 B (EP 0x03 OUT, 64-byte packets) — TFT data pipe                                     | descriptor          |
| Interface 3 | FF13:0001, input/output/feature 64 B, EP 0x86 IN only — command pipe via control transfers                                        | descriptor          |
| Screen      | 128 × 128, RGB565; user animation up to 255 frames                                                                                | official layout XML |
| Layout      | 81 keys, ANSI, key-matrix slots row×18+col                                                                                        | official key table  |

Linux nodes are assigned dynamically (`/dev/hidraw4…7` on the test machine at the time of writing);
OpenAK820 never relies on node numbers or interface numbers, only on collections.

## Related hardware (community teardowns, AK820 Pro)

HFD80CP100 MCU (SN32F299 clone), WCH CH582F radio, PY25Q128HA 16 MB SPI flash, GC9107 128×128 panel
(fpb/ajazz-ak820-pro). Not verified for the MAX PLUS.

## Linux permissions

hidraw nodes are root-only by default. Install `udev/99-openak820.rules` (grants `plugdev` and the
logged-in seat via `uaccess`) and replug. Chrome's WebHID needs the same rule.
