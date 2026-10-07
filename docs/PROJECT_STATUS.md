# Project status

Snapshot of what is real, what is partial and what is still unverified. Updated 2026-10-07.
Test hardware: one AJAZZ AK820 MAX PLUS TFT (`0C45:8009` "AK820 MAX", bcdDevice 1.07), wired, Linux.

## Works (verified on the physical keyboard)

| Item | Evidence |
|---|---|
| Dynamic detection from HID descriptors (no VID/PID or hidraw shortcuts) | `openkey detect --verbose`, five families evaluated |
| Protocol confirmation via the official START handshake (`04 18` → `04 18 00 01`) | `fixtures/device-info/ak820-max-plus-start-handshake-hw.json` |
| Per-key colour table read (`F5`) | `fixtures/rgb/ak820-max-plus-read-per-key-hw.json` |
| Device identity (VID, PID, product, manufacturer, bcdDevice, interfaces, endpoints, report sizes) | `pnpm inspect` |
| No unsolicited vendor reports over USB (8 s passive listen on FF13, FF68, FFFF) | research log |
| USB endpoint interval: bInterval 1 on all four interfaces (1 ms declared, 1000 Hz ceiling) | `lsusb -v`, sysfs |

## Implemented from official code, waiting for hardware confirmation

Keymap (base + Fn), lighting effects, per-key write, real-time colours, macros, TFT image/GIF upload,
TFT clock, sleep timer, key response, Win/Alt-Tab/Alt-F4 locks, restore keymap defaults. All packets are
reproduced byte-for-byte from the official AK820 MAX driver and pass simulator and fixture tests.
They need the owner's consent to run on the keyboard because they overwrite settings that cannot be
read back (see `docs/security.md`).

## Partial

| Item | State |
|---|---|
| Battery | Official software reads it only through the 2.4 GHz receiver (ping `20 01`, byte 3 = %). Not readable over USB on this firmware. Receiver not available for testing. |
| 2.4 GHz receiver | Detection, ping, battery, lighting packet implemented; untested. |
| Online-driver AK820 Pro family | Complete driver, simulator-tested only. |
| CRS / SinoWealth / YiChip variants | Identified by the catalogue; no configuration. |

## Mocked / simulated only

The web app's "simulated keyboard" mode and all CI tests use firmware simulators. The simulators model
the official driver's expectations; they are not evidence about the firmware.

## Unverified assumptions

* Lighting direction codes (left 0 / right 1 / up 2 / down 3).
* Macro trigger-mode byte values (borrowed from the online driver).
* bcdDevice = firmware version.
* Which controls each lighting effect honours.

## Facts established (no longer assumptions)

* No knob remapping, polling-rate setting or game-mode command exists in the official MAX software.
  The knob sends standard Consumer Control usages (volume up/down, mute) handled by the OS.
* Bluetooth: no configuration (official message).
* Battery: shown on the keyboard's TFT; the PC can read it only through the 2.4 GHz receiver.

## UI limitations

* The browser cannot see USB endpoint intervals or bcdDevice (WebHID hides them); the CLI/diagnostics show them on Linux.
* Two identical keyboards plugged in at the same time are merged by WebHID.
* WebHID with a real keyboard was not exercised automatically (it needs the browser's permission dialog).

## Next tasks

1. With the owner's consent: run the write experiments one at a time (lighting → per-key → clock →
   settings → keymap → macros → TFT), read back where possible, record fixtures, promote to CONFIRMED.
2. Plug in the 2.4 GHz receiver and run `pnpm inspect`, `openkey detect`.
3. Measure the actual report cadence with `openkey polling` while typing.
4. Capture the official driver in a Windows VM for the open questions above.
