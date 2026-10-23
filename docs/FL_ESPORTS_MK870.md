# FL Esports MK870 (`0416:C345`): guide for testers

OpenKey configures the MK870 with the official FL Esports driver's own commands (V1.06.16). The
lighting packets match, byte for byte, 45 USB captures an MK870 owner made on their keyboard
([issue #13](https://github.com/BakulBd/OpenKey/issues/13)). The other writes are decoded from the
driver and tested against a simulator, but not yet on a real MK870. That is what your test is for.

The Pulsar PCMK TKL (`0416:B23C`) uses the same protocol and the same adapter.

## What works

| Feature             | What you can do                                                                                                                     | Read back from the keyboard?                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Lighting            | 15 effects, colour, second colour, rainbow, brightness 0–4, speed 0–4, 8 directions                                                 | Yes, if the keyboard answers the lighting query |
| Per-key colours     | Paint keys and apply                                                                                                                | No                                              |
| Key map, base layer | Any key; keys with up to two modifiers (e.g. Ctrl+Shift+Esc); 9 media keys; macros; disabled; restore defaults                      | No                                              |
| Macros              | 10 macros of up to 62 presses/releases with delays; play once, several times, on/off (toggle) or while held; stored on the keyboard | No                                              |
| Sleep time          | 5 min to 1 h                                                                                                                        | No                                              |
| Protocol checks     | Two read-only questions to the keyboard, used to finish the remaining features                                                      | Only the answer's shape and the model code      |

**Not offered yet:**

- **Fn layers and onboard profiles.** They need the model code your keyboard reports (see
  "Sending your results"); with it, they can be added from the official driver's tables.
- **Music response.** The effect is offered, but it follows audio the vendor app streams.

**Never sent:** the firmware updater, serial-number and screen-firmware commands.

## Before you start

1. Use Chrome, Edge, Opera or Brave. On Linux, install the udev rule the app offers when you
   connect (it covers `0416:C345`).
2. Open the app, click **Connect keyboard** and choose the MK870. It should show **FL Esports
   MK870**.
3. When you first change something, the app asks you to turn on **experimental writes**. Each change
   is confirmed before it is sent.

**To undo:** Keymap → **Restore firmware defaults → Restore layer defaults** writes the official
default key table back. The vendor app can reset everything else.

## Test checklist

Copy this list into your report, tick what works, and describe what does not (which key, which
effect, what happened instead).

### Protocol checks (most important)

- [ ] Device Lab → **Report** → **Run all checks**. Write down both results, e.g. "Answered",
      "No answer", and the model if one is shown (`driverModel: …`).
- [ ] Lighting page: does it say "Read from the keyboard" or "Shown from OpenKey's last write"?

### Lighting

- [ ] Static with a colour of your choice; rainbow on and off.
- [ ] Breathe, Wave (each direction), Neon, Spiral, Reactive, Aurora, Ripple, Stars, Cross, Typing
      response, Auto ripple, Snake, Fireworks.
- [ ] The second colour changes the effects that use two colours.
- [ ] Brightness 0–4 and speed 0–4 (0 is the slowest).
- [ ] If the page said "Read from the keyboard": change the lighting with the keyboard's own Fn
      shortcuts, reload the page, and check that OpenKey shows the new effect.

### Per-key colours

- [ ] Paint Esc red and → green, apply: those keys light up.
- [ ] Paint one whole row: every key in it lights up, and none outside it.

### Key map

- [ ] Caps Lock → Left Ctrl.
- [ ] F1 → Win+Tab; F2 → Ctrl+Shift+Esc.
- [ ] F12 → Volume up, F11 → Mute, F8 → Play/pause.
- [ ] A key set to Disabled does nothing.
- [ ] Fn and the Fn shortcuts still work.
- [ ] Restore layer defaults brings every key back.

### Macros

- [ ] Macros page: record "Hello" in macro 1, then in Keymap set F5 → Macro 1 (play once). Pressing
      F5 types "Hello".
- [ ] Set F5 → Macro 1, play 3 times: it types "Hello" three times.
- [ ] Try "while held" and "on/off" (toggle) and note what happens.
- [ ] A macro with a long delay (e.g. 1000 ms between two keys) waits that long.

### Sleep

- [ ] Set 5 minutes and leave the keyboard idle: it sleeps after about 5 minutes.

## Sending your results

Everything goes into one GitHub comment. It takes about two minutes:

1. In the app, open **Device Lab → Report** and click **Run all checks** (if you haven't already).
2. Click **Export diagnostic package**. This saves `openkey-diagnostics.json`.
3. Open [issue #13](https://github.com/BakulBd/OpenKey/issues/13), or for another keyboard,
   [open a new issue](https://github.com/BakulBd/OpenKey/issues/new).
4. Paste your ticked checklist, and drag the `.json` file into the comment box.
5. If you can, add a short video or photo of anything that did not work.

**What the package contains:** the keyboard's USB identity and HID descriptors, OpenKey's detection,
and the result of each protocol check. For the checks, that means the shape of the answer and, for
the model query, the model code, but only if it is one of the codes the official driver lists. It
never contains your typing, key map, macros, packet bytes or serial number. You can read it before
sending: Device Lab → Report → **Preview the package**.

## Optional: captures from the official app (Windows)

These help with Fn layers, profiles and anything that does not work:

1. Install [USBPcap](https://desowin.org/usbpcap/) and [Wireshark](https://www.wireshark.org/) on
   Windows, plus the official FL Esports driver.
2. In Wireshark, capture on the USBPcap interface the keyboard is on.
3. Change **one** setting in the official app, stop the capture, and save it under a name that says
   what you changed (e.g. `fn-layer_F1_to_volume-up.pcapng`).
4. Repeat for each setting, zip the files, and attach the zip to the issue.

Captures can include anything typed while they run, so don't type passwords during a capture.
