# Competitive research

Research date: **2026-10-11** (repository metadata, READMEs and selected source files fetched that day),
extending the 2026-10-08 survey in [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md) and the AK820-specific
comparison in [reverse-engineering/public-research.md](reverse-engineering/public-research.md).

Evidence classes used below:
**[SRC]** source code inspected · **[README]** the project's own documentation (a claim, not verified) ·
**[META]** GitHub API metadata (licence, language, last push) on 2026-10-11 · **[PRIOR]** from the
2026-10-08 survey, not re-checked · **[INF]** OpenKey's inference. Nothing here was run on hardware by
OpenKey.

## Snapshot

| Project | Licence [META] | Language [META] | Last push [META] | Hardware scope | Transport | Device I/O in browser |
| ------- | -------------- | --------------- | ---------------- | -------------- | --------- | --------------------- |
| [Sharkfin](https://github.com/dniminenn/sharkfin) | GPL-3.0 | TypeScript (+ Rust/WASM core [PRIOR]) | 2026-10-08 | ROYUAN-based boards (Attack Shark, Akko …) [README] | 64 B feature reports, FFFF:0002; receiver relay [PRIOR] | yes (WASM) + Tauri desktop [PRIOR] |
| [OpenAula (not-ayan)](https://github.com/not-ayan/openaula) | none | TypeScript | 2026-09-22 | AULA F75 | feature report 6, 519 B [PRIOR] | yes (Vercel) |
| [AULA F75 Linux/WebHID (cloudglides)](https://github.com/cloudglides/aula-f75-linux-drivers) | none | TypeScript | 2026-08-31 | AULA F75 + receiver | feature 6 / receiver output 0x13 [PRIOR] | yes (local WebHID app) [README] |
| [AULA F75 Max (VitalyArt)](https://github.com/VitalyArt/Aula-F75-Max-Driver) | MIT | Swift (+ Kotlin, C shims) | 2026-09-12 | Epomaker × AULA F75 Max `0C45:800A`, receiver `05AC:024F` [SRC] | FF13 64 B commands + FF68 4096 B data; receiver FF59/FF60 32 B with checksum [SRC] | no: native macOS, Linux (hidapi/GTK4), Android (USB host) [README] |
| [VIA app](https://github.com/the-via/app) | GPL-3.0 | TypeScript | 2026-09-22 | QMK boards with VIA | raw HID FF60:0061, 32 B [PRIOR] | yes |
| [VIA keyboards](https://github.com/the-via/keyboards) | GPL-3.0 | TypeScript | 2026-09-22 | definitions (JSON v2/v3, KLE layouts) | — | — |
| [Zumap / Keylab](https://github.com/Keylab-dev/keylab) | MIT | TypeScript (Next.js) | 2026-03-23 | VIA definitions, no device | none ("WebHID" on its roadmap) [README] | no |
| [Vial GUI](https://github.com/vial-kb/vial-gui) | GPL-2.0 | Python (Qt) | 2026-05-25 | Vial-QMK boards | raw HID 32 B; definition stored in firmware [PRIOR] | via WASM build [PRIOR] |
| [Vialite](https://github.com/tcyeee/vialite) | GPL-2.0 | TypeScript | 2026-09-16 | Vial boards | WebHID | yes; keymaps, macros, tap dance, combos, lighting [META description] |
| [Micro 2 configurator](https://github.com/egegungordu/micro2-configurator) | none | JavaScript | 2026-08-03 | Work Louder Creator Micro 2 `303A:8298` | vendor raw HID, JSON-RPC with file system (`keymap.json`, SHA-1 checksums) [README] | yes, static, no build step [README] |
| [W910 WebDriver](https://github.com/luftaquila/w910-webdriver) | GPL-3.0 | JavaScript | 2026-09-10 | SXS/YXT W910 macro pad | USB, 2.4 GHz receiver **and Web Bluetooth** [README] | yes |
| [OpenAula (cvanelteren)](https://github.com/cvanelteren/OpenAula) | GPL-3.0 | Python | 2026-08-26 | AULA MINI 60 HE PRO (Hall effect) | HID config protocol; ISP flasher on an undeclared interface via libusb [README] | WebHID/WebUSB web app [README] |
| [ReConf](https://github.com/ReBotLab/ReConf) | GPL-3.0 | Svelte | 2026-08-25 | ReLow series (Hall effect), fork of hmkconf | WebHID + WebUSB (Web DFU) [README] | yes (Vercel) |
| [sinowisp](https://github.com/carlossless/sinowisp) | MIT | Rust | 2026-09-30 | SinoWealth 8051 MCUs | ISP bootloader over HID feature reports [README] | no (CLI) |
| [OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB) | GPL-2.0 [PRIOR] | C++ (Qt) | not checked | hundreds of RGB devices | HID, SMBus, USB, network [PRIOR] | no |

Official vendor tools: Keychron Launcher is a browser app (Chromium, WebHID) that requires a wired
connection and udev rules on Linux ([forum report](https://forum.endeavouros.com/t/keychron-keyboard-configuration-firmware-upates-via-launcher-keychron-com/75849),
[Linux fix](https://foosel.net/til/how-to-fix-the-webhid-connection-for-a-keychron-g5-under-linux/)).
AJAZZ ships both Windows drivers and an online WebHID driver (analysed in
[official-driver-analysis.md](reverse-engineering/official-driver-analysis.md)). Wootility, NuPhy
Console, Akko/MonsGeek and Epomaker tools were **not** verified in this session; no claim is made
about them.

## Per project: what to learn

| Project | Done well | Weak spots | OpenKey: adopt / redesign / avoid |
| ------- | --------- | ---------- | --------------------------------- |
| Sharkfin | Command family read from the board, never from the PID; opcode collisions between families acknowledged; [HW]/[FW]/[JS] evidence marks; read-only contribution bundle [PRIOR] | GPL-3.0; destructive opcodes exist in the family [PRIOR] | **Adopt** (as independent design): family identification before writes (`identified`), evidence marks (ledger). **Avoid** copying code or data tables |
| AULA F75 projects (not-ayan, cloudglides) | Trace/snapshot-based offset discovery; minimal static apps | No licence (nothing reusable); sources disagree on a keymap header byte [PRIOR] | **Adopt** read-only snapshots and diffs (packet-diff tool exists). Their signature is a *planned* adapter only |
| VitalyArt AULA F75 Max | Shared protocol core across three native apps; endpoint diagnostics view; clean constants [SRC] | Native-only; ships a "factory reset" flow that rewrites tables in sequence [SRC] | **Adopt** as independent corroboration of the `sonix-feature` command set (MIT, cited in the ledger). **Avoid** the reset flow (documented as destructive, not implemented) |
| VIA / VIA keyboards | Definitions separated from the app; large definition library | Definitions trusted without asking the firmware; central repository is a bottleneck [PRIOR] | **Redesign**: definitions are data that can name and lay out, never authorise writes |
| Zumap / Keylab | Fully client-side definition renderer | No device I/O; small project (1 star) [META] | Confirms that layout rendering alone is not support |
| Vial / Vialite | Firmware carries its own definition; physical unlock before dangerous operations; capability-gated pages [PRIOR] | GPL-2.0 | **Adopt** the principle (the device is the authority); a Vial adapter is a roadmap candidate, written from protocol facts |
| Micro 2 configurator | Verified end to end on firmware 0.6.1 with byte-for-byte checksummed write-back; explicit about what the browser cannot observe; removed a misleading feature rather than ship it [README] | No licence; single device | **Adopt** its honesty about limits (our "Not observed" list) and read-back verification |
| W910 WebDriver | Same protocol over USB, receiver and Web Bluetooth [README] | GPL-3.0; built autonomously by an LLM agent, per its README | Reinforces per-device configuration transports (`manifest.transports`) |
| OpenAula (cvanelteren) | Deep firmware RE; documents that the flash protocol lives on an undeclared interface [README] | Ships firmware flashing and code-cave patches [README] | **Avoid**: firmware modification is out of scope; note that Hall-effect boards hide protocols where browsers cannot see them |
| ReConf / hmkconf | Hall-effect feature model (actuation, rapid trigger, DKS, SOCD, calibration); demo route; i18n [README] | Includes Web DFU firmware flashing [README] | **Adopt** the capability vocabulary (already `actuation`, `rapidTrigger`, `dks`, `socd`, `calibration`); **avoid** DFU |
| sinowisp | Precise per-MCU platform table | ISP access modifies flash even on "read" [PRIOR] | Bootloader access is never "read-only": destructive class |
| OpenRGB | Zones/LEDs/modes separated from transports; detectors per family [PRIOR] | Some detectors key on VID/PID alone [PRIOR] | **Adopt** the lighting abstraction idea; **avoid** VID/PID-only detection |

## Cross-cutting findings

1. **Nobody else models unknown devices as a product feature.** Single-device tools refuse or crash on
   other hardware; Sharkfin's contribution bundle is the closest. OpenKey's verdicts, consent-gated
   probes and offline analysis of diagnostic files fill that gap.
2. **Explainable identification is rare.** Most tools filter the WebHID chooser by VID/PID and assume.
   The `258A:010C` identity is shared by unrelated products (AULA F75 and an AJAZZ "BY edition"), and
   `0C45:8009/800A` covers AJAZZ AK820 variants *and* the Epomaker × AULA F75 Max (new finding: same
   protocol family, so `0C45:800A` resolving to `sonix-feature` is plausible but unverified).
3. **Firmware flashing is common in Hall-effect tools** (ReConf DFU, cvanelteren ISP). OpenKey keeps it
   out of scope; the ledger records such operations as destructive documentation only.
4. **Licences:** most mature apps are GPL; several single-device projects have no licence at all.
   OpenKey (MIT) can only learn facts from them.
5. **Read-back verification is the exception.** Micro 2's checksum round trip and OpenKey's
   `runTransaction` read-back are the only verified-write models found.

## Facts recorded for adapters

New on 2026-10-11 (others are in [RESEARCH_MATRIX.md](RESEARCH_MATRIX.md#facts-recorded-for-future-adapters)):

| Fact | Source | OpenKey status |
| ---- | ------ | -------------- |
| Epomaker × AULA F75 Max: wired `0C45:800A`, FF13 command page, FF68 raw page, 64-byte commands, 4096-byte chunks, 128×128 display, ≤255 frames, 256-byte header | VitalyArt `Sources/AulaCore/AulaCore.swift` [SRC] | INFERRED; consistent with the AK820 official driver |
| Its command sequence uses `04 18`, `04 28`, `04 02`, `04 72`, `04 19`, `04 15`, `04 11`, `04 F0`, `04 13`, `04 17`; time packet `00 01 5A yy mm dd hh mm ss 00 weekday … AA 55` | VitalyArt `AulaDevice.swift`, `AulaCore.swift` [SRC] | INFERRED; matches the ledger |
| It labels `04 27` as lighting reset; the AK820 driver uses `27` for the Fn-layer table | same [SRC] vs official driver | conflict, recorded in the ledger |
| Receiver `05AC:024F`: command page FF59, raw page FF60, 32-byte reports, additive checksum at byte 31, battery query `20 01` | same [SRC] | INFERRED; matches `sonix-dongle` |
| Work Louder Micro 2 `303A:8298`: JSON-RPC over raw HID, file system with SHA-1 | Micro 2 README [README] | not an OpenKey target |

Unidentified identities from the project's own diagnostics, searched without result:
`258A:015E` "Gaming Keyboard" and `3151:6000` "Fantech Atom Pro Keyboard" — both remain UNKNOWN
(fixtures A and B).
