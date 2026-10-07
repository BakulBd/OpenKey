# Device safety policy

OpenKey configures keyboards; it never modifies firmware.

## Safety levels

Every write a capability offers has a level (`packages/core/src/safety.ts`):

| Level           | Meaning                                                                       | Normal UI                                 |
| --------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| READ_ONLY       | nothing is written                                                            | yes                                       |
| SAFE_VOLATILE   | RAM only; a replug restores the previous state                                | yes, when VERIFIED                        |
| SAFE_PERSISTENT | saved to flash, can be read back and changed again                            | yes, when VERIFIED                        |
| CAUTION         | saved to flash, the firmware cannot report the previous value                 | experimental opt-in                       |
| HIGH_RISK       | replaces data the keyboard cannot export (screen animation, defaults restore) | experimental opt-in, confirmed every time |
| UNSAFE          | firmware, bootloader, erase                                                   | does not exist in OpenKey                 |
| UNVERIFIED      | risk never measured                                                           | experimental opt-in                       |

`writeDecision()` combines the level with the evidence: only **VERIFIED** writes of a safe class are
offered normally. OBSERVED or INFERRED writes need **experimental writes**, a per-session opt-in that is
never remembered and is confirmed in a dialog that names the risk. HYPOTHESIS and UNKNOWN commands are
never sent. On the demo simulator every non-UNSAFE write is allowed, because nothing physical is involved.

Today, no AK820 write has been verified on hardware, so every AK820 write is experimental.

## What OpenKey sends

- Only commands whose packet layout was traced in official software or documented by a community
  source **and** listed in the protocol specifications under `docs/protocol/`.
- Detection sends nothing for unknown devices. For a device whose descriptors match a registered adapter,
  at most one documented read-only command per adapter (START for `sonix-feature`, GET_DEVICE_INFO for
  `sonix-aa55`, a VIA version query, a receiver ping), and never another family's packets once one is
  confirmed. The CRS family and planned adapters are never probed.
- Acknowledgements must echo the command; a stale echo is not accepted as success.
- Writes are transactions: validated, diffed, sent, and read back from the device where the firmware can
  report the value. Results are labelled _verified_ only after a read-back.

## What OpenKey never sends

Firmware flashing, bootloader/ISP entry, OTA, flash erase or download, calibration, factory reset,
arbitrary memory writes, or any guessed/undocumented command. For the online-driver family these codes
are blocked in the transfer layer (`BLOCKED_COMMANDS`) and raise `SafetyBlockedError`. The Windows-driver
family only contains encoders for documented commands. There is no raw-write console.

## Before writing

- Changes are local until **Apply**; studios show a diff first. Per-key writes are rate-limited because
  the table lives in flash.
- Backup/restore and profiles go through the same gate, one confirmation per section; a backup of the
  current state is kept locally before a restore.
- The CLI asks for confirmation (or `--yes`) and writes an automatic backup before keymap, macro and
  restore operations.
- Unplugging during a write ends the session; a reconnect never resumes or repeats a write.

## Recovery

The keymap can be reset with an all-default table (Restore defaults, or `openkey keymap reset`). Many
AK820 boards also reset with Fn+Esc held for a few seconds (vendor behaviour, not driven by OpenKey).
