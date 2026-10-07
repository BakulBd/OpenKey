# Other protocol families

## `sonix-dongle`: 2.4 GHz receiver

Evidence: official AK820 MAX driver `config.xml` (modes `2.4G TYPE-A`: `05AC:024F` "AJAZZ AK820 MAX 2.4G",
`0C45:FDFD` "2.4G Dongle"), `FUN_0044f5f0` and `FUN_0042b2a0`; afonsusousa/mrworldwide.

- 32-byte output reports (report ID 0). Byte 31 = sum of bytes 0–30 (mod 256).
- The official driver waits for an input report whose bytes 1–3 match the request.
- Lighting: `05 10 00 effect R G B 00 00 00 00 colorful brightness speed direction 00 00 AA 55 …`.
- Ping `20 01` → pong `20 01` (link up); status reports on page FFFF (`05 A6 … state`).
- Official `menu_wireless`: macro, lighting, user lighting and music available; **screen not available**.

OpenKey status: detection + ping probe; lighting writes behind experimental mode.

## `crs-aa55cc33`: CRS-controller AK820 Max Plus

Evidence: armoredvortex/ajazz-ak820-max-plus, arafatamim/OpenRGBAK820Plugin.
VID `1A2C`, PIDs `8FFF`/`A036`, vendor page FF02, 64-byte output reports starting `AA 55 CC 33 <op>`.
Ops: `07` mode (`mode bright speed dir colorIdx colorIdx2`, or `17 …` to enter custom mode),
`0B` begin edit, `09` apply, `0A` persist (sent twice), `0E` heartbeat, `F6`–`FB` 6 × 18 LEDs RGB.

OpenKey status: detection without I/O; writes behind experimental mode.

## `qmk-via`: community QMK

FF60:0061 raw HID, 32-byte reports. Probe: VIA `id_get_protocol_version` (0x01). OpenKey identifies
such boards and directs users to VIA/Vial; it does not reimplement VIA.

## Not supported

SinoWealth-based "AK820 MAX" (`258A:010C`, `3554:FA09`, feature report ID 6) – one community source only.
