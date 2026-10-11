# Research log

Every discovery, with its evidence. Levels: VERIFIED (hardware), OBSERVED (official code
traced byte-for-byte), INFERRED (reasoned / single community source), HYPOTHESIS.
Test unit: AJAZZ AK820 MAX PLUS TFT, USB `0C45:8009` "AK820 MAX" (SONiX), bcdDevice 1.07, wired, Linux.

---

### 2026-10-07 — USB/HID topology

- **Hardware / firmware / transport:** test unit, 1.07, USB
- **Action:** `lsusb -v`, sysfs report descriptors (no I/O to the device)
- **Raw evidence:** `re/usb/usb-descriptor.txt`, `re/descriptors/interface{2,3}.bin`, `fixtures/device-info/ak820-max-plus-usb-1.07.json`
- **Interpretation:** if2 FF68:0061 in 64 / out 4096, EP 0x84 IN + 0x03 OUT; if3 FF13:0001 in/out/feature 64, EP 0x86 IN only (outputs/features via EP0). No report IDs on either.
- **Confidence:** VERIFIED · **Source:** hardware · **Code:** `packages/hid/src/descriptor.ts`, `tests/transport/descriptor.test.ts`

### 2026-10-07 — Earlier all-zero feature reads explained

- **Action:** existing captures `re/captures/feature-read-*.txt`
- **Interpretation:** GET_FEATURE returns the echo of the last command; none had been sent, so zeros. Not a sign of a missing protocol.
- **Confidence:** VERIFIED (see START handshake below: after a command the read returns its echo) · **Code:** `sonix-feature` probe

### 2026-10-07 — Official online driver does not support this board

- **Action:** downloaded ajazz.driveall.cn bundle (2026-09-11), read config resolver `le()`/`Y()`
- **Raw evidence:** config list has `3141-32777-AJAZZ KEYBOARD`, `-AK820`, `-AK980 PRO`; no `-AK820 MAX`
- **Interpretation:** the web driver loads configs by `vid-pid-productName`; "AK820 MAX" on 0x8009 has none → AA/55 protocol is not the protocol of this board.
- **Confidence:** OBSERVED · **Source:** official online driver · **Code:** `sonix-aa55` match rule

### 2026-10-07 — Official Windows driver for the board identified

- **Action:** AJAZZ download page → "AK820 MAX&MAX PLUS … 0.85in ColorScreen … V1.0.0.5"
- **Raw evidence:** `config.xml` `<mode vid="0C45" pid="8009" product_name="AK820 MAX">`, `pid="800A"`, dongles `05AC:024F`, `0C45:FDFD`
- **Confidence:** OBSERVED · **Code:** `devices/ak820-max-plus.json`, `families/sonix-feature/variants.ts`

### 2026-10-07 — Transfer layer and command set

- **Action:** static analysis of `DeviceDriver.exe` (see `docs/reverse-engineering/official-driver-analysis.md`)
- **Interpretation:** feature report ID 0, `04 cmd`, ack byte 3 = 1, 35 ms pacing, commands 18/02/F0/13/23/F5/20/11/27/19/15/17/28/72; no device-info command.
- **Confidence:** OBSERVED · **Code:** `families/sonix-feature/{constants,frame,session}.ts`

### 2026-10-07 — Field layouts

- lighting `[effect R G B … colorful brightness speed direction … AA 55]` (`FUN_0042b100`, `FUN_0042ab40`)
- direction left 0 / right 1 / up 2 / down 3 (radio images in the light page)
- settings `[00 01 altTab altF4 win fnSwitch sleep 00 keyResponse … AA 55]` (`FUN_00414060`, control ids 160–162)
- sleep options 0/1/2/3 = never/1/5/30 min; key response levels 1–5 (combo item data)
- clock `[00 slot 5A yy mm dd hh mm ss 00 weekday … AA 55]` (`FUN_00423940`) — byte 10 is the weekday; earlier tools hard-coded 0x04
- keymap tables 576 B, slot = row×18+col, slot encoding `FUN_00418070`
- macro storage `FUN_0042d6f0`; TFT payload `FUN_00422980` (IMAGE sub = slot)
- **Confidence:** OBSERVED · **Fixtures:** `fixtures/keymap|rgb|macros|tft|device-info/sonix-feature-*.json`

### 2026-10-07 — Passive read on hardware

- **Action:** `openak820 detect --level passive` (owner authorised read-only checks)
- **Raw evidence:** GET_FEATURE → 64 × `00`
- **Confidence:** VERIFIED

### 2026-10-07 — START handshake on hardware

- **Action:** `openak820 detect --level handshake`
- **Raw evidence:** SET `04 18 00…` → GET `04 18 00 01 00…`; on a second run the passive read returned `04 18 00 01` (echo of the previous run)
- **Interpretation:** protocol family `sonix-feature` confirmed on the test unit; ack semantics confirmed.
- **Confidence:** VERIFIED · **Fixture:** `fixtures/device-info/ak820-max-plus-start-handshake-hw.json` · **Test:** `tests/device/hardware-replay.test.ts`

### 2026-10-07 — Per-key colour read on hardware

- **Action:** `openak820 info --read-lighting` (official `F5` read followed by SAVE)
- **Raw evidence:** ack `04 F5 00 01 … 09`; 9 packets of `[n, R, G, B]` for n = 0…143; entries 38–49, 56–66, 74–83, 99–102 = `1F 2F 2F`; no trailer in the read-back; SAVE ack `04 02 00 01`
- **Interpretation:** per-key read works; entry layout and index-per-entry confirmed.
- **Confidence:** VERIFIED · **Fixture:** `fixtures/rgb/ak820-max-plus-read-per-key-hw.json`

### 2026-10-07 — Echo buffer after SAVE

- **Raw evidence:** after a run ending in SAVE, the next passive read returned zeros (not `04 02 00 01`).
- **Interpretation:** the echo buffer may be cleared after SAVE/flash write or after a timeout.
- **Confidence:** INFERRED (single observation)

### 2026-10-07 — Two AK820 Pro firmware generations

- **Evidence:** kabelklaus/gohv/aks075 (FF13 + 4096-byte FF68) vs wsclx (64-byte FF68 + FF67), official online config `3141-32777-AK820` and the Windows "AK820" driver both claiming product "AK820".
- **Interpretation:** detection must use descriptors, not names.
- **Confidence:** OBSERVED · **Code:** `families/*/protocol.ts` match rules

### 2026-10-08 — Acknowledgements must echo their command

- **Evidence:** every acknowledgement captured on hardware echoes its command (`04 18 00 01`, `04 F5 … 01`, `04 02 00 01`); a passive read returns the echo of the *previous* command.
- **Interpretation:** an answer with status `01` that does not echo the current command may be a stale echo, so it is not accepted as an acknowledgement. Found by fault-injection tests (`tests/transport/mock-faults.test.ts`): a corrupted command byte was previously accepted.
- **Evidence status:** decision based on VERIFIED observations; fails safe (refuses) if a command acknowledges without echo.

### 2026-10-11 — Independent corroboration from the Epomaker × AULA F75 Max

- **Action:** read `Sources/AulaCore/AulaCore.swift` and `AulaDevice.swift` of
  [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver) (MIT; no code copied)
- **Raw evidence:** wired `0C45:800A`, command page FF13 (64-byte), raw page FF68 (4096-byte chunks),
  receiver `05AC:024F` (FF59/FF60, 32-byte, checksum at byte 31); sequences `04 18` … `04 02`, time
  packet `00 01 5A 1A mm dd hh mm ss 00 weekday … AA 55`, image `04 72`, macros `04 19`/`04 15`, keymap `04 11`
- **Interpretation:** the AULA F75 Max speaks the same `sonix-feature` family as the AK820 MAX PLUS;
  the clock layout (weekday at byte 10) matches the official-driver analysis. It labels `04 27` as a
  lighting reset, while the AK820 driver uses `27` for the Fn-layer table: **conflict, unresolved**.
- **Confidence:** INFERRED (third party) · **Code:** ledger `families/sonix-feature/ledger.ts`

### 2026-10-11 — Probe consent and identification

- **Action:** code review of detection (no hardware attached)
- **Interpretation:** the START handshake was sent automatically to any FF13:0001 device, and AA/55
  GET_DEVICE_INFO to any small vendor in/out collection, including numbered ones. Both now need an
  identity the vendor software targets, or the user's consent; AA/55 requires unnumbered reports.
- **Evidence status:** policy decision; regression tests in `tests/safety/invariants.test.ts`

## Open questions (need hardware with consent)

| Question                                        | Proposed experiment                              | Status                 |
| ----------------------------------------------- | ------------------------------------------------ | ---------------------- |
| Do lighting writes behave as traced?            | experiments 02–05 via OpenKey on the test unit | waiting for consent    |
| Direction code mapping                          | Scrolling effect, each direction                 | waiting                |
| Macro mode byte for "repeat"/"toggle"           | assign macro with each mode, observe             | waiting                |
| Keymap write/reset                              | experiments 06–08                                | waiting                |
| `04 27`: Fn-layer table or lighting reset?       | write an Fn-layer remap, observe Fn behaviour and lighting | waiting        |
| Per-key write path                              | `openkey verify per-key --experimental`          | tool ready, waiting    |
| TFT upload/animation timing                     | experiments 11–14                                | waiting                |
| What the 2.4 GHz receiver exposes               | plug in receiver, `pnpm inspect`                 | receiver not connected |
| Whether Bluetooth exposes any vendor collection | pair, `pnpm inspect --all`                       | not yet observed       |
