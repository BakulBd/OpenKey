/**
 * Razer Chroma keyboards. Every command is one 90-byte feature report (report ID 0) on the keyboard's
 * control collection, answered by the same report with a status byte:
 *
 *   0  status (0 in requests; 2 ok, 1 busy, 3 failed, 4 timeout, 5 not supported)
 *   1  transaction id (per model)
 *   2  remaining packets (u16 BE, 0)    4  protocol type (0)
 *   5  data size    6  command class    7  command id (bit 7 set = read)
 *   8..87 arguments    88 XOR of bytes 2..87    89 0
 *
 * Facts from openrazer (driver/razercommon.c, razerchromacommon.c; GPL-2.0) and OpenRGB
 * (Controllers/RazerController; GPL-2.0): facts only, re-implemented here. The model table (USB
 * product ID, command set, transaction id, LED matrix size) is OpenRGB's.
 */
export const RAZER_PROTOCOL_ID = 'razer-chroma';
export const RAZER_VID = 0x1532;
export const REPORT_BYTES = 90;

export type MatrixSet = 'std' | 'ext';

export interface RazerModel {
  productId: number;
  name: string;
  /** Command set: "standard" (class 03) or "extended" (class 0F) matrix commands. */
  set: MatrixSet;
  transactionId: number;
  rows: number;
  cols: number;
}

const MODELS: readonly [number, string, MatrixSet, number, number, number][] = [
  [0x0241, 'BlackWidow 2019', 'ext', 0x1f, 6, 22],
  [0x0203, 'BlackWidow Chroma', 'std', 0x3f, 6, 22],
  [0x0211, 'BlackWidow Chroma Overwatch', 'std', 0x3f, 6, 22],
  [0x0209, 'BlackWidow Chroma Tournament Edition', 'std', 0x3f, 6, 22],
  [0x0221, 'BlackWidow Chroma V2', 'std', 0x3f, 6, 22],
  [0x0228, 'BlackWidow Elite', 'ext', 0x1f, 6, 22],
  [0x024e, 'BlackWidow V3', 'ext', 0x3f, 6, 22],
  [0x025a, 'BlackWidow V3 Pro (Wired)', 'ext', 0x3f, 6, 22],
  [0x025c, 'BlackWidow V3 Pro (Wireless)', 'ext', 0x3f, 6, 22],
  [0x0a24, 'BlackWidow V3 TKL', 'ext', 0x3f, 6, 18],
  [0x0258, 'BlackWidow V3 Mini (Wired)', 'ext', 0x1f, 5, 16],
  [0x0271, 'BlackWidow V3 Mini (Wireless)', 'ext', 0x9f, 5, 16],
  [0x0287, 'BlackWidow V4', 'ext', 0x1f, 8, 23],
  [0x028d, 'BlackWidow V4 Pro', 'ext', 0x1f, 8, 23],
  [0x02b3, 'BlackWidow V4 Pro 75% (Wired)', 'ext', 0x1f, 6, 18],
  [0x02b4, 'BlackWidow V4 Pro 75% (Wireless)', 'ext', 0x1f, 6, 18],
  [0x02a5, 'BlackWidow V4 75% (Wired)', 'ext', 0x1f, 6, 18],
  [0x0293, 'BlackWidow V4 X', 'ext', 0x1f, 6, 22],
  [0x02d7, 'BlackWidow V4 TKL (Wired)', 'ext', 0x1f, 6, 18],
  [0x02d5, 'BlackWidow V4 TKL (Wireless)', 'ext', 0x9f, 6, 18],
  [0x02d4, 'BlackWidow V4 Low Profile TKL (Wired)', 'ext', 0x1f, 6, 18],
  [0x02d2, 'BlackWidow V4 Low Profile TKL (Wireless)', 'ext', 0x9f, 6, 18],
  [0x0216, 'BlackWidow X Chroma', 'std', 0x3f, 6, 22],
  [0x021a, 'BlackWidow X Chroma Tournament Edition', 'std', 0x3f, 6, 22],
  [0x022a, 'Cynosa Chroma', 'ext', 0x3f, 6, 22],
  [0x025e, 'Cynosa v2', 'ext', 0x1f, 6, 22],
  [0x023f, 'Cynosa Lite', 'ext', 0x3f, 1, 1],
  [0x021e, 'Ornata Chroma', 'ext', 0x3f, 6, 22],
  [0x025d, 'Ornata Chroma V2', 'ext', 0x1f, 6, 22],
  [0x028f, 'Ornata V3', 'ext', 0x1f, 1, 10],
  [0x02a1, 'Ornata V3 rev2', 'ext', 0x1f, 1, 10],
  [0x02a3, 'Ornata V3 TKL', 'ext', 0x1f, 1, 8],
  [0x0294, 'Ornata V3 X', 'ext', 0x1f, 1, 1],
  [0x02a2, 'Ornata V3 X Rev2', 'ext', 0x1f, 1, 1],
  [0x0295, 'Deathstalker V2', 'ext', 0x1f, 6, 22],
  [0x0298, 'DeathStalker V2 Pro TKL (Wired)', 'ext', 0x1f, 6, 17],
  [0x0296, 'DeathStalker V2 Pro TKL (Wireless)', 'ext', 0x9f, 6, 17],
  [0x0290, 'DeathStalker V2 Pro (Wireless)', 'ext', 0x9f, 6, 22],
  [0x0292, 'DeathStalker V2 Pro (Wired)', 'ext', 0x9f, 6, 22],
  [0x0227, 'Huntsman', 'ext', 0x3f, 6, 22],
  [0x0226, 'Huntsman Elite', 'ext', 0x3f, 9, 22],
  [0x0266, 'Huntsman V2 Analog', 'ext', 0x3f, 9, 22],
  [0x0257, 'Huntsman Mini', 'ext', 0x3f, 5, 15],
  [0x0282, 'Huntsman Mini Analog', 'ext', 0x1f, 5, 15],
  [0x0243, 'Huntsman Tournament Edition', 'ext', 0x3f, 6, 18],
  [0x026b, 'Huntsman V2 TKL', 'ext', 0x3f, 6, 17],
  [0x026c, 'Huntsman V2', 'ext', 0x3f, 6, 22],
  [0x02a6, 'Huntsman V3 Pro', 'ext', 0x3f, 6, 22],
  [0x02a7, 'Huntsman V3 Pro TKL White', 'ext', 0x3f, 6, 19],
  [0x02e4, 'Huntsman V3 HE Magnetic Mini', 'ext', 0x3f, 6, 22],
  [0x0244, 'Tartarus Pro', 'ext', 0x1f, 1, 21],
  [0x022b, 'Tartarus V2', 'ext', 0x1f, 4, 6],
];

export const RAZER_MODELS: readonly RazerModel[] = MODELS.map(
  ([productId, name, set, transactionId, rows, cols]) => ({
    productId,
    name: `Razer ${name}`,
    set,
    transactionId,
    rows,
    cols,
  }),
);

export const razerModel = (vendorId: number, productId: number) =>
  vendorId === RAZER_VID ? RAZER_MODELS.find((m) => m.productId === productId) : undefined;
