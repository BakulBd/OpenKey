import type { KeyboardLayout, PhysicalKey } from '@openkey/core';
import type { HubModel } from './models.js';
import index from './web-index.json' with { type: 'json' };

/**
 * AULA / AJAZZ boards from AJAZZ's own web driver (ajazz.driveall.cn, `pnpm ajazz-web`). The web
 * driver keys its board configurations by `vendorId:productId:productName`; OpenKey does the same,
 * and falls back to the USB identity alone when it names a single board.
 */
export interface WebBoard {
  vendorId: number;
  productId: number;
  name: string;
  /** Pages the web driver offers: customKeys, lighting, macro, performance, advancedKeys, tft, led … */
  routes: string[];
  fn: boolean;
  fnDisabled: number[];
  brightness?: [number, number];
  speed?: [number, number];
  macroSpace: boolean;
  /** Key rows: [key number, HID usage, name, layout class]. */
  rows: [number, number, string, string][][];
}

const INDEX = index as [number, number, string][];

/** The web driver's entry for a device: exact product name, or the only board on that USB ID. */
export function webIdentity(
  vendorId: number,
  productId: number,
  productName: string,
): [number, number, string] | undefined {
  const same = INDEX.filter(([v, p]) => v === vendorId && p === productId);
  return (
    same.find(([, , n]) => n === productName.trim()) ?? (same.length === 1 ? same[0] : undefined)
  );
}

export async function loadWebBoard(id: [number, number, string]): Promise<WebBoard | null> {
  const mod: { default: unknown } = await import('./web-boards.json', { with: { type: 'json' } });
  return (
    (mod.default as WebBoard[]).find(
      (b) => b.vendorId === id[0] && b.productId === id[1] && b.name === id[2],
    ) ?? null
  );
}

const SOURCE =
  'AJAZZ’s own web driver (ajazz.driveall.cn): board configuration, key rows and key numbers; matched by USB identity and product name';

/** An OpenKey model for a web-driver board: key map always, LEDs numbered like its keys. */
export function webModel(b: WebBoard): HubModel {
  const keys: Record<string, number> = {};
  for (const [value, , name] of b.rows.flat()) keys[name] = value;
  keys['Fn'] ??= b.rows.flat().find(([, usage]) => usage === 175)?.[0] ?? -1;
  const lit = b.routes.includes('lighting');
  return {
    name: /^(AJAZZ|AULA)\b/i.test(b.name) ? b.name : `${b.name} (AULA/AJAZZ web-driver board)`,
    vendorId: b.vendorId,
    productId: b.productId,
    link: 'usb',
    infoBytes: 48,
    body: { vendorId: b.vendorId, productId: b.productId },
    keys,
    ...(lit ? { ledMap: keys, ledAssumed: true } : {}),
    web: b,
    source: SOURCE,
  };
}

/** Width in key units from a `w-N` class: N + 2 pixels per 16 (Ctrl w-18 = 1.25, Tab w-22 = 1.5). */
const units = (px: number) => Math.round(((px + 2) / 16) * 4) / 4;

/**
 * The board drawn from the web driver's own rows: key widths from its `w-N` classes, gaps from its
 * margin classes, and flexible keys (`flex-1`, `ml-auto`, `mr-auto`) filling the row to the width of
 * the widest fixed row.
 */
export function webLayout(id: string, name: string, b: WebBoard): KeyboardLayout {
  type Item = { key?: [number, number, string]; w: number; flex: boolean; h: number };
  const rows: Item[][] = b.rows.map((row) => {
    const items: Item[] = [];
    for (const [value, usage, label, cls] of row) {
      const t = cls.split(/\s+/).filter(Boolean);
      const px = (p: string) => Number(t.find((c) => c.startsWith(p))?.slice(p.length));
      if (t.includes('ml-auto')) items.push({ w: 0, flex: true, h: 1 });
      else if (px('ml-') > 0) items.push({ w: units(px('ml-') - 2), flex: false, h: 1 });
      const w = px('w-');
      items.push({
        key: [value, usage, label],
        w: w > 0 ? units(w) : 1,
        flex: t.includes('flex-1'),
        h: px('h-') > 0 ? Math.max(1, Math.round((px('h-') + 2) / 16)) : 1,
      });
      if (t.includes('mr-auto')) items.push({ w: 0, flex: true, h: 1 });
      else if (px('mr-') > 0) items.push({ w: units(px('mr-') - 2), flex: false, h: 1 });
    }
    return items;
  });
  const fixed = (r: Item[]) => r.reduce((a, i) => a + (i.flex && !i.key ? 0 : i.flex ? 1 : i.w), 0);
  const width = Math.max(...rows.map(fixed));
  const keys: PhysicalKey[] = [];
  rows.forEach((r, y) => {
    const flexes = r.filter((i) => i.flex).length;
    const spare = Math.max(0, width - fixed(r));
    let x = 0;
    for (const i of r) {
      const w = i.flex ? (i.key ? 1 : 0) + spare / flexes : i.w;
      if (i.key) {
        const [value, usage, label] = i.key;
        const isFn = usage === 175 || label === 'Fn';
        keys.push({
          id: `k${value}`,
          label: label.replace(/^ˉ /, ''),
          slot: isFn ? -1 : value,
          light: b.routes.includes('lighting') ? value : null,
          usage: usage <= 0xe7 ? usage : 0,
          x: Math.round(x * 4) / 4,
          y,
          w: Math.max(1, Math.round(w * 4) / 4),
          h: i.h,
        });
      }
      x += w;
    }
  });
  // A two-row key (ISO Enter, number-pad +) that would cover the key below keeps one row.
  for (const k of keys)
    if (
      k.h > 1 &&
      keys.some(
        (o) =>
          o !== k &&
          o.y > k.y &&
          o.y < k.y + k.h &&
          o.x < k.x + k.w - 0.01 &&
          k.x < o.x + o.w - 0.01,
      )
    )
      k.h = 1;
  // Rounding can make neighbours touch: trim the left key back to its neighbour.
  for (const k of keys)
    for (const o of keys)
      if (o !== k && o.y === k.y && k.x < o.x && k.x + k.w > o.x + 0.01)
        k.w = Math.max(0.5, o.x - k.x);
  return {
    id,
    name,
    width: Math.max(...keys.map((k) => k.x + k.w)),
    height: Math.max(...keys.map((k) => k.y + k.h)),
    keys,
    source: SOURCE,
  };
}
