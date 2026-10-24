# FL Esports MK870 (`0416:C345`): guide for testers

OpenKey configures the MK870 with the official FL Esports driver's own commands (V1.06.16). The
lighting packets match, byte for byte, 45 USB captures an MK870 owner made on their keyboard
([issue #13](https://github.com/BakulBd/OpenKey/issues/13)), and the same owner tested OpenKey on
it: **lighting, per-key colours, the base and FN1 key maps, all 10 macros and restore defaults are
verified** and work without the experimental switch. Only the **sleep time** still needs a test, and
the fix for the lights going dark on connection needs a confirmation: that is what the checklist
below is for.

The Pulsar PCMK TKL (`0416:B23C`) uses the same protocol and the same adapter.

## What works

| Feature          | What you can do                                                                                                                     | Status       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Lighting         | 15 effects, colour, second colour, rainbow, brightness 0–4, speed 0–4, 8 directions                                                 | Verified     |
| Per-key colours  | Paint keys and apply                                                                                                                | Verified     |
| Key map, base    | Any key, keys with up to two modifiers, 9 media keys, macros, disabled                                                              | Verified     |
| Key map, FN1     | The same, on the second layout (see below how to use it)                                                                            | Verified     |
| Restore defaults | Writes the official default table back to a layer                                                                                   | Verified     |
| Macros           | 10 macros of up to 62 presses/releases with delays; play once, several times, on/off (toggle) or while held; stored on the keyboard | Verified     |
| Sleep time       | 5 min to 1 h: after this long without a key press the lights turn off and the keyboard sleeps; any key wakes it                     | Experimental |
| Model check      | One read-only question to the keyboard (Device Lab), only when you click it                                                         | Diagnostic   |

The keyboard cannot report its settings, so OpenKey shows what it last wrote. Changes made with the
Fn shortcuts are not shown in the app.

**Nothing is sent when the app connects.** Earlier builds asked the keyboard for its lighting on
connection, and the lights went dark until another effect was chosen. That query is gone.

**Two layouts on the keyboard.** The MK870 stores a base layer and an FN1 layer, and OpenKey edits
both (Keymap → _Base layer_ / _FN1 layer (Fn+Tab)_). To use FN1: **hold Fn+Tab for 3 seconds,
release both keys, then press the key on its own** (release Fn first; Fn+key still gives the built-in
Fn shortcut). Do the same to go back to the base layer. The Fn shortcuts below are built into the
keyboard and are not changed by either layer. Switching layouts is done on the keyboard; OpenKey
does not switch them from the computer.

**If anything goes wrong:** Keymap → Restore firmware defaults → _Restore layer defaults_ writes the
official default table back to that layer, and **holding Fn+Esc for 3 seconds** restores the
keyboard's factory defaults.

**Music response** is offered, but it follows audio the vendor app streams.

**Never sent:** the firmware updater, serial-number and screen-firmware commands.

## Before you start

1. Use Chrome, Edge, Opera or Brave. On Linux, install the udev rule the app offers when you
   connect (it covers `0416:C345`).
2. Open the app, click **Connect keyboard** and choose the MK870. It should show **FL Esports
   MK870**.
3. Verified features apply after a confirmation. Only the sleep time asks you to turn on
   **experimental writes** first.

**To undo:** Keymap → **Restore firmware defaults → Restore layer defaults** writes the official
default key table back. The vendor app can reset everything else.

## Test checklist

Copy this list into your report, tick what works, and describe what does not (which key, which
effect, what happened instead).

### Connecting

- [ ] Connect: the lighting stays as it was (it no longer goes dark), and Fn+↑ / Fn+↓ still change
      the brightness.

### Sleep (most important)

- [ ] Device settings → Sleep: set **5 minutes** and apply (turn on experimental writes when asked).
      Leave the keyboard alone: after about 5 minutes the lights turn off. A key press wakes it.
- [ ] Set **1 hour** and apply: the lights stay on after 5 minutes without typing.

### Model check

- [ ] Device Lab → **Report** → **Run all checks**. Write down the result and the model if one is
      shown (`driverModel: …`), and whether the lights changed when you clicked it.

### Already verified (only if you want to re-check)

- [ ] Lighting effects, per-key colours, base and FN1 keys, macros and restore defaults still work.

## Built-in Fn shortcuts (from the keyboard's manual)

These are part of the keyboard's firmware; OpenKey does not change them. Results from an MK870 owner
on Linux (COSMIC):

| Keys                       | Function                                     | Owner's test  |
| -------------------------- | -------------------------------------------- | ------------- |
| Fn + Ins / Home / Del      | Lighting mode / direction / interactive mode | Working       |
| Fn + End / PgUp / PgDn     | Custom lighting modes                        | Working       |
| Fn + PrtSc / ScrLk / Pause | RGB mode / single colours                    | Working       |
| Fn + ← / →, Fn + ↑ / ↓     | Animation speed, brightness                  | Working       |
| Fn + Esc (hold 3 s)        | Factory defaults                             | Working       |
| Fn + Tab (hold 3 s)        | Switch base / FN1 layer                      | Working       |
| Fn + Win                   | Lock / unlock the Win key                    | Working       |
| Fn + ~                     | Full-key / 6-key rollover                    | Inconclusive  |
| Fn + F2 … F8               | Volume, mute, stop, previous, play, next     | Working       |
| Fn + F1, F9, F10, F11      | Player, email, home page, calculator         | Not on COSMIC |
| Fn + F12                   | Lock all keys                                | Working       |

## Sending your results

Everything goes into one GitHub comment. It takes about two minutes:

1. In the app, open **Device Lab → Report** and click **Run all checks** (if you haven't already).
2. Click **Export diagnostic package**. This saves `openkey-diagnostics.json`.
3. Open [issue #13](https://github.com/BakulBd/OpenKey/issues/13), or for another keyboard,
   [open a new issue](https://github.com/BakulBd/OpenKey/issues/new).
4. Paste your ticked checklist, and drag the `.json` file into the comment box.
5. If you can, add a short video or photo of anything that did not work.

**What the package contains:** the keyboard's USB identity and HID descriptors, OpenKey's detection,
and the result of the model check: the shape of the answer and the model code, but only if it is one
of the codes the official driver lists. It
never contains your typing, key map, macros, packet bytes or serial number. You can read it before
sending: Device Lab → Report → **Preview the package**.

## Optional: captures from the official app (Windows)

These help with anything that does not work:

1. Install [USBPcap](https://desowin.org/usbpcap/) and [Wireshark](https://www.wireshark.org/) on
   Windows, plus the official FL Esports driver.
2. In Wireshark, capture on the USBPcap interface the keyboard is on.
3. Change **one** setting in the official app, stop the capture, and save it under a name that says
   what you changed (e.g. `fn-layer_F1_to_volume-up.pcapng`).
4. Repeat for each setting, zip the files, and attach the zip to the issue.

Captures can include anything typed while they run, so don't type passwords during a capture.
