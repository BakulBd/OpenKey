import data from './via-index.json' with { type: 'json' };

/**
 * Every keyboard with a VIA definition in the-via/keyboards, by USB identity (facts only; built by
 * `pnpm via-index`). Used to name VIA boards and to answer "will my board work?" before connecting;
 * detection still asks the keyboard itself.
 */
export interface ViaBoard {
  /** VVVV:PPPP */
  id: string;
  name: string;
  /** Vendor folder in the-via/keyboards (lower case, as published). */
  vendor: string;
}

export const VIA_INDEX_SOURCE: string = data.source;
export const VIA_INDEX_DATE: string = data.generated;
export const VIA_BOARDS: readonly ViaBoard[] = (data.boards as [string, string, string][]).map(
  ([id, name, vendor]) => ({ id, name, vendor }),
);

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** VIA boards with this USB identity (several boards can share one). */
export function viaBoardsFor(vendorId: number, productId: number): ViaBoard[] {
  const id = `${hex4(vendorId)}:${hex4(productId)}`;
  return VIA_BOARDS.filter((b) => b.id === id);
}
