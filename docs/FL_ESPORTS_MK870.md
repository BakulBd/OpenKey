# FL Esports MK870 (`0416:C345`): status and test checklist

OpenKey configures the MK870 with the commands of the official FL Esports driver (V1.06.16) and the
lighting packet of [keyboard-colour](https://github.com/Mqlvin/keyboard-colour). Every write is
**experimental**: it is built from those sources and tested against a simulator, but nobody has run
it on a real MK870 yet. Your test decides what becomes "verified".

The Pulsar PCMK TKL (`0416:B23C`) uses the same protocol and the same adapter.

## What OpenKey does

| Feature             | How                                                                                                                                                                  | Read back?                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Lighting            | 14 effects, colour, second colour, rainbow, brightness 0–4, speed 0–4, 8 directions                                                                                  | Yes, if the keyboard answers the lighting query when you connect |
| Per-key colours     | Paint keys, apply; the keyboard switches to its custom effect                                                                                                        | No                                                               |
| Key map, base layer | Any key, keys with up to two modifiers (e.g. Win+Tab), 9 media keys (volume, mute, play/pause, next, previous, stop, player, calculator), disabled, restore defaults | No                                                               |
| Sleep time          | 5 min, 10 min, 15 min, 30 min, 1 h (the lighting turns off at the same time)                                                                                         | No                                                               |
| Protocol check      | Device Lab → Report → Run check: one read-only lighting query                                                                                                        | It only records the shape of the answer                          |

Not offered:

- **FN1/FN layers:** their factory contents are unknown, and writing them would erase the Fn
  functions.
- **Macros:** the vendor app plays them itself; the keyboard stores none.
- **Music rhythm:** needs audio streamed from the app.
- **Firmware update and serial number:** never sent.

## Before you start

1. Use Chrome, Edge, Opera or Brave. On Linux, install the udev rule the app offers (it includes
   `0416:C345`).
2. Connect the keyboard and check that the app shows **FL Esports MK870**.
3. Turn on **experimental writes** when the app asks. Each change is confirmed first.

If something goes wrong with the key map, **Keymap → Restore firmware defaults → Restore layer defaults** writes the driver's
own default table back. The vendor app can also reset everything.

## Checklist

Tick what works, and note what does not (which key, which effect, what you saw instead).

**Connection**

- [ ] The keyboard is detected as FL Esports MK870.
- [ ] Device Lab → Report → **Run check** says "Answered" (or note what it says).
- [ ] Lighting page: does it say "Read from the keyboard" or "Shown from OpenKey's last write"?

**Lighting**

- [ ] Static, with a colour of your choice.
- [ ] Breathe, Wave (each direction), Neon, Spiral (clockwise / anticlockwise), Reactive, Aurora,
      Ripple, Stars, Cross, Typing response, Auto ripple, Snake, Fireworks.
- [ ] Second colour changes something on the effects that use two colours.
- [ ] Rainbow on and off.
- [ ] Brightness 0–4 and speed 0–4 change as expected (note which end is fastest).
- [ ] If the page said "Read from the keyboard": change the lighting on the keyboard with its own
      Fn shortcuts, reload the page, and check that OpenKey shows the new effect.

**Per-key colours**

- [ ] Paint Esc red and → green, apply: the right keys light up.
- [ ] Paint a whole row: every key in the row lights, none outside it.

**Key map**

- [ ] Caps Lock → Left Ctrl.
- [ ] F1 → Win+Tab (or another combination with one modifier).
- [ ] F2 → Ctrl+Shift+Esc (two modifiers).
- [ ] F12 → Volume up; F11 → Mute; F8 → Play/pause.
- [ ] A key set to Disabled does nothing.
- [ ] Fn still works, and the Fn shortcuts still work.
- [ ] Restore layer defaults brings every key back.

**Sleep**

- [ ] Set 5 minutes, leave the keyboard idle: it sleeps after about 5 minutes.

## Reporting

Open **Device Lab → Report**, export the diagnostic package, and attach it to an issue with your
checklist. The package holds the USB identity, the HID descriptors, the answer shape of the protocol
check and OpenKey's detection. It never holds your typing, key map contents, packet bytes or serial
number.
