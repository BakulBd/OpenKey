# Safety policy

OpenAK820 configures keyboards; it never modifies firmware.

## What OpenAK820 sends

- Only commands whose packet layout was traced in official AJAZZ software or documented by a community
  source **and** listed in the protocol specifications under `docs/protocol/`.
- Detection sends nothing at the `descriptor` level, only reads at `passive`, and at most one official
  read-only/handshake command per protocol at `handshake` (START for `sonix-feature`, GET_DEVICE_INFO for
  `sonix-aa55`, a VIA version query, a receiver ping). The CRS family is never probed.
- Writes from INFERRED evidence (online-protocol TFT upload, 2.4 GHz lighting, CRS) require experimental
  mode, which is off by default.
- Unrecognised product strings on a recognised protocol may not write keymaps until experimental mode is
  enabled, because key positions are unknown.

## What OpenAK820 never sends

Firmware flashing, bootloader/ISP entry, OTA commands, flash erase/download, calibration, factory reset,
arbitrary memory writes, or any guessed/undocumented command. For the online-driver family these command
codes are blocked in the transfer layer (`BLOCKED_COMMANDS`) and raise `SafetyBlockedError` before
anything reaches the device. The Windows-protocol driver only contains encoders for documented commands.

## Before writing

- The CLI asks for confirmation (or `--yes`) and writes an automatic backup before keymap, macro and restore
  operations (`~/.config/openak820/backups/`).
- The web app asks for confirmation once per session and offers backup export/import with a change preview.
- Settings the firmware cannot report are kept as "mirrors" so they can be backed up and restored.

## Recovery

Firmware defaults: the keymap can be reset with an all-default table (`openak820 keymap reset`). Many AK820
boards also reset with Fn+Esc held for a few seconds (vendor behaviour, not driven by OpenAK820).
