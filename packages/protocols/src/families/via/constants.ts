/**
 * The VIA protocol: QMK's raw HID configuration interface (`quantum/via.h`, `quantum/via.c`; QMK,
 * GPL-2.0 — facts only). Every keyboard running QMK with VIA enabled speaks it, and Vial firmware
 * answers the same commands. One 32-byte output report (report ID 0) on usage page FF60, usage 61;
 * the reply is a 32-byte input report that echoes the command byte, or `FF` when unhandled.
 */

export const VIA_PROTOCOL_ID = 'qmk-via';
export const RAW_USAGE_PAGE = 0xff60;
export const RAW_USAGE = 0x61;
export const REPORT_SIZE = 32;
/** Bulk keymap and macro transfers carry at most 28 bytes after the 4-byte header. */
export const CHUNK = 28;
export const REPLY_TIMEOUT_MS = 500;

export const Cmd = {
  GET_PROTOCOL_VERSION: 0x01,
  GET_KEYBOARD_VALUE: 0x02,
  SET_KEYBOARD_VALUE: 0x03,
  KEYMAP_GET_KEYCODE: 0x04,
  KEYMAP_SET_KEYCODE: 0x05,
  CUSTOM_SET_VALUE: 0x07,
  CUSTOM_GET_VALUE: 0x08,
  CUSTOM_SAVE: 0x09,
  MACRO_GET_COUNT: 0x0c,
  MACRO_GET_BUFFER_SIZE: 0x0d,
  MACRO_GET_BUFFER: 0x0e,
  MACRO_SET_BUFFER: 0x0f,
  KEYMAP_GET_LAYER_COUNT: 0x11,
  KEYMAP_GET_BUFFER: 0x12,
  KEYMAP_SET_BUFFER: 0x13,
  KEYMAP_GET_ENCODER: 0x14,
  KEYMAP_SET_ENCODER: 0x15,
} as const;

/**
 * Commands OpenKey never sends: they erase the keymap, macros or all settings, or put the keyboard
 * into its bootloader. Kept here so tests can prove no code path builds them.
 */
export const FORBIDDEN = {
  DYNAMIC_KEYMAP_RESET: 0x06,
  EEPROM_RESET: 0x0a,
  BOOTLOADER_JUMP: 0x0b,
  MACRO_RESET: 0x10,
} as const;

export const UNHANDLED = 0xff;

export const KeyboardValue = {
  UPTIME: 0x01,
  LAYOUT_OPTIONS: 0x02,
  SWITCH_MATRIX_STATE: 0x03,
  FIRMWARE_VERSION: 0x04,
  DEVICE_INDICATION: 0x05,
  KEYCODES_VERSION: 0x06,
} as const;

/** Lighting channels of `id_custom_*_value`; each answers only when the firmware has that feature. */
export const Channel = {
  BACKLIGHT: 1,
  RGBLIGHT: 2,
  RGB_MATRIX: 3,
  LED_MATRIX: 5,
} as const;
export type LightingChannel = (typeof Channel)[keyof typeof Channel];

/** Value ids shared by the RGB light, RGB matrix and LED matrix channels. */
export const LightValue = { BRIGHTNESS: 1, EFFECT: 2, SPEED: 3, COLOR: 4 } as const;

/** Protocol version from which keycodes use the v2 ranges (QMK 0.19+); older firmware uses v1. */
export const KEYCODES_V2_FROM = 0x000c;
