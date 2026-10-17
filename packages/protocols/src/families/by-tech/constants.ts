/**
 * The BY Tech OEM keyboard protocol ("BYCOMBO4"; the vendor driver class is `CDevG5KB`), used by
 * keyboards on BY Tech / SinoWealth controllers that ship the same OEM Windows driver: AULA F75,
 * F87, F99, H108 and RK (Royal Kludge) boards such as the R75 RGB.
 *
 * Every command is one feature report of 519 bytes after the report ID:
 *
 *   byte 0      command            bit 7 set = read
 *   byte 1      parameter          layer / sub-selector
 *   byte 2      0
 *   byte 3      total packages     ceil(len / 512)
 *   byte 4      package index      0-based
 *   byte 5..6   payload length     little endian, <= 512
 *   byte 7..    payload            zero padded
 *
 * A read is a SET_FEATURE of the request header followed by a GET_FEATURE on the same report ID; the
 * reply echoes the command and carries the data from byte 7.
 *
 * Sources: leisiji/AulaSofwareLinux src/proto.rs (MIT; recovered from the vendor driver and
 * verified on an AULA F75); the RK R75 RGB's own driver configuration (`Dev/015E/KB.ini`: `Fw=`,
 * `Psd=`), which uses the same identification scheme. See docs/RESEARCH_MATRIX.md.
 */

export const BY_TECH_PROTOCOL_ID = 'by-tech';

/** Vendor collection carrying the command channel. */
export const VENDOR_USAGE_PAGE = 0xff00;
/** Command report size after the report ID: 7 header bytes + one 512-byte page. */
export const REPORT_BYTES = 519;
export const PAGE_BYTES = 512;
export const HEADER_BYTES = 7;
/** Report IDs the vendor driver uses: 6 for firmware id 0x18, 9 otherwise; the descriptor decides. */
export const REPORT_IDS = [6, 9] as const;

export const Cmd = {
  /** Identity read; parameter 1 returns the six-byte model code (`Psd=` in the vendor profiles). */
  GET_INFO: 0x82,
  /** Lighting / settings page read. */
  GET_LED: 0x84,
  /** Lighting / settings page write (read-modify-write only). */
  SET_LED: 0x04,
  /**
   * Screen parameters (`SetScreenParam`): volume, CPU, memory, date and time for the screen of RK's
   * screen boards; fire-and-forget over the cable (ElXreno/rk-m87-sync docs/PROTOCOL.md, MIT).
   */
  SET_SCREEN_PARAM: 0x0b,
} as const;

/** `SetScreenParam` payload: 14 bytes. */
export const SCREEN_PARAM_BYTES = 14;

/**
 * The screen-parameter payload: volume, CPU and memory (0–100), year (16-bit LE), month, day, hour,
 * minute, second and day of week (0 = Sunday), raw integers. OpenKey runs in a browser, which cannot
 * read the computer's volume or load, so those fields are 0.
 */
export function screenParams(d: Date): Uint8Array {
  const y = d.getFullYear();
  return Uint8Array.of(
    0,
    0,
    0,
    y & 0xff,
    y >> 8,
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getDay(),
    0,
    0,
    0,
  );
}

export const INFO_IDENTITY = 0x01;
export const IDENTITY_BYTES = 6;

/** Settings page: 128 bytes ending in the firmware's own `5A A5` marker. */
export const SETTINGS_PAGE_BYTES = 128;
export const PAGE_MARKER = [0x5a, 0xa5] as const;

/** The vendor driver waits 20 ms around every transfer and retries a failed SET three times. */
export const TRANSFER_DELAY_MS = 20;
export const RETRY_DELAY_MS = 70;
export const SET_RETRIES = 3;

/** USB vendor ID of the BY Tech / SinoWealth wired boards (shared by unrelated products). */
export const SINOWEALTH_VID = 0x258a;
