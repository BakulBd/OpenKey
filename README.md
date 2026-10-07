# OpenKey

**An open-source, cross-platform WebHID configurator for the AJAZZ AK820 keyboard family.**

OpenKey configures AJAZZ AK820 keyboards without the vendor software: keymap and Fn layer, lighting,
per-key colours, macros, the TFT screen (images, GIFs, clock) and keyboard settings. It runs in a
Chromium browser via WebHID, and as a command-line tool (`openkey`) on Linux.

It is one application for the whole family. Connect a keyboard and OpenKey reads its HID
descriptors, works out which of the several incompatible AK820 protocols it speaks, confirms that with a
read-only probe, and shows only the features that keyboard actually has.

> OpenKey does not distribute proprietary AJAZZ firmware or proprietary driver binaries.

## Supported keyboards

| Keyboard                                                | Status                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AK820 MAX / MAX PLUS with TFT (`0C45:8009` "AK820 MAX") | Protocol confirmed on hardware; per-key colour read verified; writes implemented from the official driver, awaiting hardware confirmation |
| AK820 Pro, Windows-driver firmware                      | Same protocol family; implemented                                                                                                         |
| AK820 Pro, online-driver firmware; AK820 MAX HE         | Online-driver protocol; implemented, not hardware-tested                                                                                  |
| AK820 2.4 GHz receivers                                 | Detected; lighting experimental                                                                                                           |
| CRS-based "AK820 Max Plus" (`1A2C`)                     | Detected; lighting experimental                                                                                                           |
| AK820 Pro with community QMK                            | Identified; use VIA                                                                                                                       |

Details: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## How detection works

1. **Enumerate.** All HID interfaces of the device are grouped (WebHID `HIDDevice.collections`, or Linux
   sysfs report descriptors parsed by OpenKey).
2. **Match.** Each protocol family checks the descriptors: usage pages, usages, report IDs and report
   sizes. Example: the AK820 MAX has a 64-byte feature report on usage page FF13 and a 4096-byte output
   report on FF68; an online-driver AK820 Pro has a 64-byte output report on FF68 instead.
3. **Probe.** Matching families run one documented read-only command (for the AK820 MAX the official
   START handshake, answered with `04 18 00 01`).
4. **Select.** The best confirmed candidate wins; ties are reported, never guessed.

`openkey detect --verbose` prints the whole reasoning:

```
Candidate protocol: AJAZZ Windows-driver protocol (feature reports on FF13 + 4096-byte data on FF68)
  Descriptor match: yes, score 100
  Probe: PASS – Firmware acknowledged the official START handshake on the FF13 control pipe.
Candidate protocol: AJAZZ online-driver protocol (AA/55 output reports)
  Descriptor match: NO (FF68 output report is 4096 bytes: a bulk data pipe, not an AA/55 command pipe)
Selected: sonix-feature
Confidence: VERIFIED
```

## Using the web app

WebHID is available in Chromium-based browsers (Chrome, Edge, Opera, Brave, Vivaldi) on HTTPS or
`http://localhost`. Firefox and Safari do not support it; the app says so instead of showing a connect
button, and offers a simulated keyboard to explore the interface.

```
pnpm install
pnpm dev            # http://localhost:5173
pnpm build:web      # static site in apps/web/dist, deploy behind HTTPS
```

Connect the keyboard with a USB data cable in wired mode. Settings are not configurable over Bluetooth
(the official software does not support it either); over 2.4 GHz only part of the configuration exists.

**Linux:** install the udev rule so Chrome (and the CLI) may open the keyboard:

```
sudo cp udev/99-openkey.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger   # then replug the keyboard
```

## Using the CLI

```
pnpm openkey list
pnpm openkey detect --verbose
pnpm openkey info [--read-lighting]
pnpm openkey keymap set Caps=key:ctrl F12=consumer:mute [--layer fn]
pnpm openkey rgb set --effect Static --color '#ff0000' --brightness 5
pnpm openkey perkey set --all '#202040'
pnpm openkey macro set 0 "down:a,wait:20,up:a"
pnpm openkey tft upload picture.gif --fit cover --dither
pnpm openkey clock sync
pnpm openkey backup | restore backup.json --dry-run
pnpm openkey diagnostics --json
```

`pnpm build:cli` produces a standalone `tools/cli/dist/openkey.mjs`. Every write asks for confirmation
(or `--yes`); keymap, macro and restore operations save a backup first. `OPENKEY_DEBUG=1` prints every
HID report with timing.

## Current features (AK820 MAX / MAX PLUS)

| Feature                                                     | Read                  | Write |
| ----------------------------------------------------------- | --------------------- | ----- |
| Device identity, protocol, capabilities                     | yes                   | —     |
| Keymap and Fn layer, defaults restore                       | remembered*           | yes   |
| Lighting effects (20), colour, brightness, speed, direction | remembered*           | yes   |
| Per-key colours                                             | **yes (from device)** | yes   |
| Macros (100 slots)                                          | remembered*           | yes   |
| TFT image / GIF (128×128, up to 255 frames), clock          | —                     | yes   |
| Sleep timer, key response, Win/Alt-Tab/Alt-F4 locks         | remembered*           | yes   |
| Backup / restore with change preview                        | yes                   | yes   |

\* The firmware is write-only for these settings (the official software never reads them either);
OpenKey shows what it last wrote and labels it accordingly.

## Known limitations

- Writes for the AK820 MAX are reproduced byte-for-byte from the official driver; so far only reads and the
  handshake have been exercised on the test unit. See the open questions in
  [docs/RESEARCH_LOG.md](docs/RESEARCH_LOG.md).
- No battery level over USB on the Windows-protocol firmware; the knob is not remappable on any Sonix AK820.
- The 2.4 GHz receiver protocol is only partly known; Bluetooth has no configuration channel.
- The MAX and MAX PLUS report the same USB identity; OpenKey cannot tell them apart.
- WebHID merges two identical keyboards plugged in at the same time.

## Safety

OpenKey never flashes firmware, enters the bootloader, erases flash, runs factory resets or sends
guessed commands; such commands are blocked in code. See [docs/security.md](docs/security.md).

## Reverse-engineering methodology

The official AJAZZ Windows driver for the AK820 MAX was analysed statically to recover the transfer layer
and every command; findings were then verified on the hardware with read-only commands, and the captured
bytes became regression fixtures. Public projects were surveyed and their conflicting claims resolved
against the official code: [docs/reverse-engineering/](docs/reverse-engineering/),
[docs/protocol/](docs/protocol/), [docs/RESEARCH_LOG.md](docs/RESEARCH_LOG.md).

## Development

```
pnpm install
pnpm test          # unit, protocol, simulator and hardware-replay tests (no keyboard needed)
pnpm typecheck
pnpm lint
pnpm inspect       # Linux device inspector (sysfs, no permissions needed)
pnpm probe         # first-contact probe, saves a fixture
pnpm packet-diff a.json b.json
OPENKEY_HIL=1 pnpm test   # hardware-in-the-loop tests (opt-in)
```

Layout: `packages/` (core, hid, hid-node, protocols, tft, profiles), `apps/web`, `tools/` (cli,
device-inspector, probe-device, packet-diff, capture), `devices/`, `fixtures/`, `tests/`, `docs/`.
Architecture: [docs/architecture.md](docs/architecture.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Not affiliated with AJAZZ. AJAZZ and AK820 are trademarks of their owner.
