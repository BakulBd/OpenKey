/**
 * AJAZZ Windows-driver protocol ("sonix-feature").
 *
 * Evidence: official AJAZZ "AK820 MAX&MAX PLUS Tri-mode RGB 0.85in ColorScreen" driver V1.0.0.5,
 * DeviceDriver.exe (MSVC x86, image base 0x400000). Function addresses below refer to that binary.
 * The AK820 PRO Screen V1.0.0.5 driver contains the same command set.
 * See docs/protocol/sonix-feature.md for the full write-up.
 */

/** Control pipe: vendor collection with a 64-byte feature report (no report ID). */
export const CONTROL_USAGE_PAGE = 0xff13;
export const CONTROL_USAGE = 0x01;
/** Data pipe: vendor collection with a 4096-byte output report (no report ID). */
export const DATA_USAGE_PAGE = 0xff68;
export const DATA_USAGE = 0x61;

/** Neither collection declares report IDs; Windows passes report ID 0 (FUN_0044eed0 builds buf[0]=0). */
export const REPORT_ID = 0;
export const PACKET_SIZE = 64;
export const DATA_CHUNK_SIZE = 4096;

/**
 * AK820 Pro screen framing (gohv/EPOMAKER-Ajazz-AK820-Pro and Beattrey/ajazz-ak820-config, MIT):
 * still images use IMAGE sub-command 02 with no header, opened by START with enable = 1 and closed by
 * FINISH; animations use the header framing with sub-command 03.
 */
export const PRO_STILL_SUB = 0x02;
export const PRO_ANIMATION_SUB = 0x03;

/** First payload byte of every command packet (stored as the low byte of a 16-bit immediate, e.g. 0x1804). */
export const COMMAND_PREFIX = 0x04;

/** Command codes, payload byte 1. */
export const Cmd = {
  /** Commit a configuration transaction to flash. Every write flow ends with it. */
  SAVE: 0x02,
  /** Base-layer keymap table follows (576 bytes). FUN_00418420(layer=0). */
  KEYMAP_BASE: 0x11,
  /** Global lighting effect; data packet follows. FUN_0042b100. */
  LIGHT_MODE: 0x13,
  /** Macro storage follows (index + data). FUN_0042d6f0. */
  MACRO_DATA: 0x15,
  /** System settings (sleep, key response, OS key locks); data packet follows. FUN_00414060. */
  SETTINGS: 0x17,
  /** Opens a configuration transaction. */
  START: 0x18,
  /** Precedes a macro upload (sent instead of START). FUN_0042d6f0. */
  MACRO_BEGIN: 0x19,
  /** Live (non-persistent) per-key colours. FUN_004329e0. */
  REALTIME_RGB: 0x20,
  /** Per-key colour table follows (576 bytes). FUN_0044ba10. */
  PER_KEY_RGB: 0x23,
  /** Fn-layer keymap table follows. FUN_00418420(layer=1). */
  KEYMAP_FN: 0x27,
  /** Clock data packet follows. FUN_00423940. */
  TIME: 0x28,
  /** TFT animation upload on the data pipe follows. FUN_00422980. */
  IMAGE: 0x72,
  /** Closes a lighting/keymap transaction. */
  FINISH: 0xf0,
  /** Reads the per-key colour table back (the only configuration read). FUN_0042aee0. */
  READ_PER_KEY_RGB: 0xf5,
} as const;
export type CmdCode = (typeof Cmd)[keyof typeof Cmd];

export const CMD_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Cmd).map(([k, v]) => [v, k]),
);

/** GET_FEATURE after a command echoes it with payload[3] = 0x01 (FUN_0044eed0 checks byte 3 == 1). */
export const ACK_OFFSET = 3;
export const ACK_OK = 0x01;
/** FUN_0044f0c0 retries once when payload[3] == 0xFF (device busy). */
export const ACK_BUSY = 0xff;

/** Delay before every feature transfer (layouts/rgb-keyboard.xml <cmd_delaytime value="35"/>). */
export const CMD_DELAY_MS = 35;
/** FUN_0044f3a0 (multi-packet read) uses 3/5 ms sleeps instead of cmd_delaytime. */
export const READ_PRE_DELAY_MS = 3;
export const READ_ACK_DELAY_MS = 5;
/** FUN_004511f0: ReadFile timeout for the per-chunk acknowledgement on the data pipe. */
export const DATA_ACK_TIMEOUT_MS = 300;
/** FUN_0042d6f0 sleeps 30 ms around the macro data transfer. */
export const MACRO_SETTLE_MS = 30;
/** FUN_0044eed0 retries a failed SET_FEATURE inside multi-packet writes up to 10 times. */
export const MAX_PACKET_RETRIES = 10;

/** Trailer written at the end of data packets and tables (word 0x55AA little endian → AA 55). */
export const TRAILER = [0xaa, 0x55] as const;

/** Keymap / per-key tables: 144 slots × 4 bytes = 576 bytes = 9 packets. */
export const TABLE_BYTES = 0x240;
export const TABLE_PACKETS = TABLE_BYTES / PACKET_SIZE;
export const TABLE_SLOTS = TABLE_BYTES / 4;
/** Single-colour backlight boards use a 192-byte brightness table (3 packets) instead. */
export const MONO_TABLE_BYTES = 0xc0;
/** Real-time colour stream: 512 bytes = 8 packets of packed [led, r, g, b]. */
export const REALTIME_BYTES = 0x200;

/** Lighting effect id that displays the per-key table (FUN_0044b900 writes mode 0x80). */
export const CUSTOM_EFFECT = 0x80;

/** Macro storage (FUN_0042d6f0): 100 index entries × 4 bytes, data from byte 400. */
export const MACRO_SLOTS = 100;
export const MACRO_INDEX_BYTES = 0x190;
export const MACRO_BUFFER_BYTES = 0xe00;
/** Capacity check: (events) × 8 must not exceed 0xA8C bytes. */
export const MACRO_EVENT_BUDGET_BYTES = 0xa8c;
export const MACRO_HEADER_BYTES = 8;
export const MACRO_EMPTY_ENTRY = 0xffffffff;
export const MACRO_MIN_DELAY_MS = 10;
export const MacroFlags = {
  KEY_DOWN: 0xb0,
  KEY_UP: 0x30,
  MOUSE_DOWN: 0x90,
  MOUSE_UP: 0x10,
  DELAY: 0x50,
} as const;

/** TFT animation header (FUN_00422980): 256 bytes, [0]=frames, [1+i]=delay/2 ms, rest 0xFF. */
export const TFT_HEADER_BYTES = 256;
export const TFT_DELAY_UNIT_MS = 2;
