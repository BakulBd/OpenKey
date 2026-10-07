/**
 * AJAZZ online-driver protocol ("sonix-aa55"), reimplemented from the official web driver
 * https://ajazz.driveall.cn (bundle layout-classic-CcyMQaqB.js, 2026-09-11): frame builder `ht`,
 * response parser `hd`, transfer loop `ya`, response waiter `so`, command enum `Ye`.
 */

export const OUT_MAGIC = 0xaa;
export const IN_MAGIC = 0x55;
export const HEADER_BYTES = 8;
/** `ya` falls back to 32 when the descriptor gives no output report size. */
export const DEFAULT_PACKET_BYTES = 32;
/** `ya` reads `sendReport(So=0, …)`. */
export const REPORT_ID = 0;
export const DEFAULT_TIMEOUT_MS = 500;
export const DEFAULT_RETRIES = 3;

/** Collections the official driver accepts as configuration interfaces (`B()` filter). */
export const CONFIG_USAGE_PAGES = [0xff68, 0xff80, 0xff60, 0xff00, 0xff01, 0xff1b];
/** TFT/animation data pipe (`Ut(productId, 65383)`). */
export const TFT_USAGE_PAGE = 0xff67;
/** `|| 4104` default output size of the TFT pipe; payload per chunk = size − 8. */
export const TFT_DEFAULT_REPORT_BYTES = 4104;
/** Chunk header bytes 6–7: (6619136 / 4096) = 0x0650 little endian. */
export const TFT_PAYLOAD_CLASS = 0x0650;

export const Cmd = {
  GET_DEVICE_INFO: 16,
  GET_GAME_MODE: 17,
  GET_KEY: 18,
  GET_LED_EFFECT: 19,
  GET_CUSTOM_LED_DATA: 20,
  GET_MACRO: 21,
  GET_FN_KEY: 22,
  GET_DEFAULT_FN_KEY_MATRIX: 28,
  GET_DEFAULT_KEY_MATRIX: 31,
  SET_GAME_MODE: 33,
  SET_KEY: 34,
  SET_LED_EFFECT: 35,
  SET_CUSTOM_LED_DATA: 36,
  SET_MACRO: 37,
  SET_FN_KEY: 38,
  SET_TEMPORARY_COMMAND_DATA: 52,
  SET_LED_USER_ANIMATION: 65,
  SET_TFT_USER_ANIMATION: 80,
  SET_TFT_BUILT_IN_INDEX: 81,
} as const;

/**
 * Commands OpenAK820 never sends: factory reset, flash download, calibration, OTA/bootloader.
 * The transfer layer refuses them unconditionally.
 */
export const BLOCKED_COMMANDS = new Set<number>([
  15, // SET_FACTORY_RESET
  79, // SET_FLASH_DOWNLOAD
  100,
  101,
  105,
  106, // calibration on/off (v1/v2)
  102,
  103, // simulation test
  128,
  129,
  130,
  131,
  132,
  133,
  134, // OTA_*: system info, verify, ENTER_BOOT, send firmware, SN, switch partition, set SN
]);

export const CMD_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Cmd).map(([k, v]) => [v, k]),
);

export const DEVICE_INFO_BYTES = 48;
export const GAME_MODE_BYTES = 56;
export const LED_EFFECT_BYTES = 16;
export const KEY_TABLE_BYTES = 512;
export const KEY_SLOTS = 128;
export const CUSTOM_LED_BYTES = 512;
export const MACRO_INDEX_BYTES = 400;
export const MACRO_SLOTS = 100;
/** `_n`: macroSpaceSize is used only when macroConfig.isGetMaxMacroSpaceSize, else 512. */
export const DEFAULT_MACRO_SPACE = 512;
