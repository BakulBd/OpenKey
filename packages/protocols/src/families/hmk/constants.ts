/**
 * libhmk (Hall-effect keyboard firmware) raw HID protocol. Facts from peppapighs/libhmk
 * include/commands.h, src/commands.c, include/usb_descriptors.h, include/common.h, src/keycodes.c
 * and the hmkconf configurator (GPL-3.0; facts only): one 64-byte output report on usage page
 * FFAB, usage AB, report ID 0; the reply echoes the command id, or 0xFF when the command failed.
 */
export const HMK_PROTOCOL_ID = 'hmk';
export const HMK_USAGE_PAGE = 0xffab;
export const HMK_USAGE = 0xab;
export const REPORT_SIZE = 64;
export const REPLY_TIMEOUT_MS = 500;
export const FAILED = 0xff;

export const HmkCmd = {
  FIRMWARE_VERSION: 0,
  GET_PROFILE: 8,
  GET_METADATA: 13,
  GET_KEYMAP: 128,
  SET_KEYMAP: 129,
  GET_ACTUATION_MAP: 130,
  SET_ACTUATION_MAP: 131,
  GET_TICK_RATE: 134,
} as const;

/**
 * Never sent: reboot, bootloader, factory reset, recalibration, calibration writes, profile reset and
 * copy, and the calibration-threshold save.
 */
export const HMK_FORBIDDEN = {
  REBOOT: 1,
  BOOTLOADER: 2,
  FACTORY_RESET: 3,
  RECALIBRATE: 4,
  SET_CALIBRATION: 7,
  RESET_PROFILE: 11,
  DUPLICATE_PROFILE: 12,
  SAVE_CALIBRATION_THRESHOLD: 15,
} as const;

/** Bytes per chunk: GET_KEYMAP returns 63, SET_KEYMAP takes 59; actuation maps go 15 keys at a time. */
export const KEYMAP_GET_CHUNK = 63;
export const KEYMAP_SET_CHUNK = 59;
export const ACTUATION_CHUNK = 15;
export const METADATA_CHUNK = 59;
