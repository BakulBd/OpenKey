# AJAZZ AK820 MAX PLUS investigation

Systematic record of what is known about the project's reference keyboard, how it is known, and what
may be tried next. Updated 2026-10-11. Detailed byte layouts are in [protocol/sonix-feature.md](protocol/sonix-feature.md);
the machine-checked command ledger is `packages/protocols/src/families/sonix-feature/ledger.ts`.

Evidence labels: **HW** directly verified on the physical unit · **DESC** confirmed by descriptors or OS
enumeration · **DRV** official vendor software (static analysis) · **3P** third-party project ·
**INF** inference · **HYP** untested hypothesis.

## 1. The unit

| Item         | Value                                                  | Evidence                                         |
| ------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Product      | AJAZZ AK820 MAX PLUS, tri-mode, 0.85" TFT              | owner                                            |
| USB identity | `0C45:8009`, manufacturer "SONiX", product "AK820 MAX" | DESC `re/usb/usb-descriptor.txt`                 |
| bcdDevice    | 1.07                                                   | DESC. That it equals the firmware version is HYP |
| Speed        | Full speed (12 Mbit/s), bus-powered, remote wakeup     | DESC                                             |
| Host         | Linux, hidraw; nodes `/dev/hidraw4…7` at capture time  | DESC. Session-dependent, never hard-coded        |

## 2. Interface and report map

Report sizes exclude the report-ID byte. "EP0" means the report travels as a control transfer.

| If  | Endpoints                  | Collection (page:usage)   | Report ID | Input | Output                            | Feature      | Role                                   | Evidence      |
| --- | -------------------------- | ------------------------- | --------- | ----- | --------------------------------- | ------------ | -------------------------------------- | ------------- |
| 0   | 0x81 IN, 64 B, bInterval 1 | 0001:0006 Keyboard (boot) | none      | 8     | 1 (LEDs, EP0)                     | —            | standard typing                        | DESC          |
| 1   | 0x82 IN, 64 B, bInterval 1 | 000C:0001 Consumer        | 3         | 2     | —                                 | —            | media keys, knob (volume ±, mute)      | DESC          |
| 1   |                            | 0001:0080 System          | 2         | 1     | —                                 | —            | power/sleep keys                       | DESC          |
| 1   |                            | 0001:0006 Keyboard (NKRO) | 1         | 15    | —                                 | —            | n-key-rollover bitmap (120 keys)       | DESC          |
| 1   |                            | 0001:0002 Mouse           | 6         | 4     | —                                 | —            | mouse keys / macros                    | DESC          |
| 1   |                            | FFFF:0001 vendor          | 5         | 3     | —                                 | —            | unknown; no traffic seen in 8 s listen | DESC          |
| 2   | 0x84 IN, 0x03 OUT, 64 B    | FF68:0061 vendor          | none      | 64    | **4096** (interrupt OUT, chunked) | —            | screen data pipe                       | DESC, DRV     |
| 3   | 0x86 IN, 64 B              | FF13:0001 vendor          | none      | 64    | 64 (EP0)                          | **64** (EP0) | configuration control pipe             | DESC, DRV, HW |

**Input transport vs configuration transport.** Typing uses interfaces 0–1. Configuration uses the FF13
feature report (commands, acknowledgements, reads) and the FF68 output report (screen data only). The
knob is not configurable: it emits standard Consumer Control usages (DRV: no remap command exists).

## 3. WebHID vs Linux

| Aspect                                             | Linux hidraw (CLI)                                                              | WebHID (browser)                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Interface numbers, endpoints, bInterval, bcdDevice | visible (sysfs)                                                                 | hidden; collections only                                                                       |
| Interface 0/1 (typing)                             | readable with permissions                                                       | blocked by Chromium for keyboard collections                                                   |
| FF13 feature reports                               | `HIDIOCSFEATURE` / `HIDIOCGFEATURE`; buffer `[0x00, 64 bytes]`                  | `sendFeatureReport(0, 64 bytes)` / `receiveFeatureReport(0)`                                   |
| Leading report-ID byte                             | hidraw strips a leading `0x00`: always write `[id, payload…]` (3P aks075-linux) | handled by the browser; some platforms prefix the ID on read (normalised in `WebHidTransport`) |
| FF68 4096-byte output                              | `write()` of 4097 bytes                                                         | `sendReport(0, 4096 bytes)`; not yet run against hardware                                      |

## 4. The all-zero feature reads, resolved

`re/tools/read_feature.c` issued `HIDIOCGFEATURE` on the FF13 node and received 65 bytes of zeros three
times (`re/captures/feature-read-*.txt`). This was **not** evidence of a missing protocol:

1. The descriptor declares the FF13 feature report without a report ID, so report ID 0 and 64 payload
   bytes (65 with the ID byte) are correct (DESC).
2. In the official driver, a GET_FEATURE only follows a SET_FEATURE: it reads the _acknowledgement_ of
   the last command (DRV `FUN_0044eed0`).
3. On hardware, after sending START `04 18`, the read returned `04 18 00 01` (HW, fixture
   `fixtures/device-info/ak820-max-plus-start-handshake-hw.json`), and a later passive read returned that
   same echo. Zeros simply mean "no command since power-up" (HW).

## 5. What is established

| Fact                                                                                                                                                                                                          | Evidence                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration family is `sonix-feature` (`04 cmd` framing on FF13)                                                                                                                                            | HW (START acknowledged with echo)                                                                                                                                                               |
| Per-key colour table can be read (`04 F5`, 9 × 64 bytes `[n R G B]`)                                                                                                                                          | HW, fixture `rgb/ak820-max-plus-read-per-key-hw.json`                                                                                                                                           |
| Acknowledgements echo their command; a passive read returns the previous echo                                                                                                                                 | HW                                                                                                                                                                                              |
| The official per-key read ends with SAVE (a flash commit of unchanged state)                                                                                                                                  | DRV, reproduced on HW                                                                                                                                                                           |
| No device-info, keymap, macro, lighting or settings read command exists                                                                                                                                       | DRV (absence in the official driver)                                                                                                                                                            |
| No polling-rate, game-mode or knob command exists in the official software                                                                                                                                    | DRV                                                                                                                                                                                             |
| Battery is readable only through the 2.4 GHz receiver (ping `20 01`)                                                                                                                                          | DRV; 3P VitalyArt (same receiver `05AC:024F`)                                                                                                                                                   |
| Settings are not configurable over Bluetooth                                                                                                                                                                  | DRV (message 62)                                                                                                                                                                                |
| bInterval 1 on all endpoints: a _declared_ 1 ms ceiling, not a measured rate and not a setting                                                                                                                | DESC                                                                                                                                                                                            |
| **New (2026-10-11):** the Epomaker × AULA F75 Max (`0C45:800A`, FF13 + FF68 4096) uses the same command set (START 18, SAVE 02, FINISH F0, TIME 28 with weekday at byte 10, IMAGE 72, macro 19/15, keymap 11) | 3P [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver) (MIT, used on hardware by its author). Independent corroboration of the DRV analysis; INFERRED for OpenKey |
| **Conflict:** VitalyArt labels its `04 27` step "Resetting lighting data"; the AK820 driver uses `27` for the Fn-layer table                                                                                  | DRV vs 3P; unresolved, recorded in the ledger                                                                                                                                                   |

## 6. Identification strategy (implemented)

1. **Descriptors** (no I/O): FF13:0001 with a 64-byte feature report, plus FF68:0061 with a 4096-byte
   output report. Report sizes and IDs must match; VID/PID alone selects nothing.
2. **Consent policy:** the START handshake runs automatically only for identities the official
   driver targets (`0C45:8009/800A` with product "AK820 MAX" or "AK820"). Any other device with this
   topology gets _no_ packet until the user allows it, and is shown as a strong candidate.
3. **Family identification:** START must be acknowledged _with the echo_ `04 18`. A readable report or
   an all-zero answer never identifies the family.
4. **Verdict:** this unit (identity + bcdDevice 1.07) is a `verifiedIdentities` entry, so it is a
   VERIFIED_MATCH. Another firmware or an AK820 Pro is FIRMWARE_UNVERIFIED. Over Bluetooth it is
   TRANSPORT_UNSUPPORTED.

## 7. Safe experiments, in order

Each needs the owner's consent, one at a time, with a backup first. None has been run since 2026-10-07.

| #   | Experiment                   | Command                                               | Establishes                                                                             | Risk / side effects                                                                                                              |
| --- | ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Real keyboard in the browser | open the app → Connect                                | WebHID path: grouping, START, per-key read in Chromium                                  | none beyond the verified read (which ends with SAVE)                                                                             |
| 2   | **Per-key write round trip** | `pnpm openkey verify per-key --experimental`          | first VERIFIED write: PER_KEY_RGB + LIGHT_MODE(0x80) + SAVE/FINISH, proven by read-back | key colours unchanged; the lighting effect switches to per-key mode, and the previous effect cannot be read back (note it first) |
| 3   | Report cadence               | Latency lab, `openkey polling`                        | measured report interval vs declared 1 ms                                               | none (passive)                                                                                                                   |
| 4   | Clock                        | `openkey clock sync --experimental`                   | TIME packet and weekday byte                                                            | visible on the screen; harmless                                                                                                  |
| 5   | Lighting effect              | `openkey rgb set … --experimental`                    | effect/direction codes (watch the keyboard)                                             | replaces the effect; cannot be read back                                                                                         |
| 6   | Settings                     | `openkey settings set … --experimental`               | settings packet offsets                                                                 | each setting observable by behaviour; cannot be read back                                                                        |
| 7   | Keymap                       | `openkey keymap set F12=consumer:mute --experimental` | slot encoding on hardware; the `27` conflict (Fn layer vs lighting)                     | backup first; `keymap reset` restores defaults                                                                                   |
| 8   | Macros, then TFT upload      | studios / CLI                                         | last; largest payloads                                                                  | HIGH_RISK class; confirm every time                                                                                              |
| 9   | 2.4 GHz receiver             | plug in; `pnpm inspect`, `openkey detect`             | receiver identity, ping, battery                                                        | ping is read-only                                                                                                                |

After each run: commit the evidence record (reviewed, colour values are personal data) as a
`fixtures/**/…-hw.json`, add the unit to the adapter's `verifiedIdentities` scope, move the ledger
entry to VERIFIED, and update [HARDWARE_TEST_MATRIX.md](HARDWARE_TEST_MATRIX.md). The ledger tests
refuse a VERIFIED entry without a hardware fixture.

## 8. Never send to this keyboard

- Any command not in the ledger, any guessed opcode, sub-command, offset, length or checksum.
- Opcode scans or "try every report ID" loops (the community scanner in kabelklaus/ajazz-ak820-pro is
  explicitly not adopted).
- Firmware update, bootloader entry, the vendor reset buttons, or a reproduction of the third-party
  "factory reset" sequence (documentation-only ledger entries; `implemented: false`).
- Writes over Bluetooth, or AA/55 online-driver frames (a different family; its matcher rejects this
  topology).
- Writes to FF68 other than screen chunks announced by `04 72`.

## 9. Regression guards

| Guard                                                                                                               | Test                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Real descriptors → FF13/FF68 parsed exactly                                                                         | `tests/transport/descriptor.test.ts`                                                          |
| Offline (descriptor-only) analysis is a STRONG_CANDIDATE, never write-eligible; FFFF:0001 never mistaken for ROYUAN | `tests/safety/invariants.test.ts` with `fixtures/diagnostics/ak820-max-plus-descriptors.json` |
| Hardware START capture → VERIFIED detection                                                                         | `tests/device/hardware-replay.test.ts`                                                        |
| Same topology, other identity → no START without consent                                                            | `tests/safety/invariants.test.ts`, `tools/e2e/smoke.mjs`                                      |
| Ledger ↔ command constants ↔ capability evidence                                                                    | `tests/protocol/ledger.test.ts`                                                               |
| Stale echo never accepted as an acknowledgement                                                                     | `tests/transport/mock-faults.test.ts`                                                         |
