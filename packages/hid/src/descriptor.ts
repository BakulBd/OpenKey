import type { HidCollection, HidReportInfo } from './types.js';

/**
 * Minimal HID report-descriptor parser (HID 1.11 §6.2.2). Produces the same top-level collection
 * model WebHID exposes, so Linux (sysfs descriptors) and browsers feed identical data to protocol
 * detection. Long items are skipped; only what detection needs is tracked.
 */

interface GlobalState {
  usagePage: number;
  reportSize: number;
  reportCount: number;
  reportId: number;
}

interface ParsedItem {
  offset: number;
  tag: number;
  type: number;
  size: number;
  value: number;
}

const TYPE_MAIN = 0;
const TYPE_GLOBAL = 1;
const TYPE_LOCAL = 2;

const MAIN_INPUT = 0x8;
const MAIN_OUTPUT = 0x9;
const MAIN_FEATURE = 0xb;
const MAIN_COLLECTION = 0xa;
const MAIN_END_COLLECTION = 0xc;

const GLOBAL_USAGE_PAGE = 0x0;
const GLOBAL_REPORT_SIZE = 0x7;
const GLOBAL_REPORT_ID = 0x8;
const GLOBAL_REPORT_COUNT = 0x9;
const GLOBAL_PUSH = 0xa;
const GLOBAL_POP = 0xb;

const LOCAL_USAGE = 0x0;

export function* hidItems(desc: Uint8Array): Generator<ParsedItem> {
  let i = 0;
  while (i < desc.length) {
    const prefix = desc[i]!;
    if (prefix === 0xfe) {
      // Long item: [0xFE, size, tag, data...]
      const size = desc[i + 1] ?? 0;
      i += 3 + size;
      continue;
    }
    const sizeCode = prefix & 0x3;
    const size = sizeCode === 3 ? 4 : sizeCode;
    let value = 0;
    for (let k = 0; k < size; k++) value |= (desc[i + 1 + k] ?? 0) << (8 * k);
    yield { offset: i, tag: prefix >> 4, type: (prefix >> 2) & 0x3, size, value: value >>> 0 };
    i += 1 + size;
  }
}

function addBits(map: Map<number, number>, reportId: number, bits: number): void {
  map.set(reportId, (map.get(reportId) ?? 0) + bits);
}

function toReports(map: Map<number, number>): HidReportInfo[] {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([reportId, bits]) => ({ reportId, size: Math.ceil(bits / 8) }));
}

export function parseReportDescriptor(desc: Uint8Array): HidCollection[] {
  const collections: HidCollection[] = [];
  let g: GlobalState = { usagePage: 0, reportSize: 0, reportCount: 0, reportId: 0 };
  const stack: GlobalState[] = [];
  let localUsages: number[] = [];
  let depth = 0;
  interface Builder {
    page: number;
    usage: number;
    input: Map<number, number>;
    output: Map<number, number>;
    feature: Map<number, number>;
    /** Position in `children`, reserved when the collection opens (descriptor order). */
    slot: number;
  }
  const builder = (page: number, usage: number, slot = -1): Builder => ({
    page,
    usage,
    slot,
    input: new Map(),
    output: new Map(),
    feature: new Map(),
  });
  const build = (b: Builder): HidCollection => ({
    usagePage: b.page,
    usage: b.usage,
    inputReports: toReports(b.input),
    outputReports: toReports(b.output),
    featureReports: toReports(b.feature),
  });
  let current: Builder | null = null;
  /** Open nested collections, innermost last. */
  const open: Builder[] = [];
  /** Nested collections of the current top-level collection, in descriptor order. */
  let children: HidCollection[] = [];
  /** Reports are counted on the top-level collection and on the innermost nested one. */
  const add = (kind: 'input' | 'output' | 'feature', bits: number) => {
    if (!current) return;
    addBits(current[kind], g.reportId, bits);
    const inner = open[open.length - 1];
    if (inner) addBits(inner[kind], g.reportId, bits);
  };

  for (const it of hidItems(desc)) {
    if (it.type === TYPE_GLOBAL) {
      switch (it.tag) {
        case GLOBAL_USAGE_PAGE:
          g.usagePage = it.value & 0xffff;
          break;
        case GLOBAL_REPORT_SIZE:
          g.reportSize = it.value;
          break;
        case GLOBAL_REPORT_COUNT:
          g.reportCount = it.value;
          break;
        case GLOBAL_REPORT_ID:
          g.reportId = it.value & 0xff;
          break;
        case GLOBAL_PUSH:
          stack.push({ ...g });
          break;
        case GLOBAL_POP:
          g = stack.pop() ?? g;
          break;
      }
      continue;
    }
    if (it.type === TYPE_LOCAL) {
      if (it.tag === LOCAL_USAGE) localUsages.push(it.value);
      continue;
    }
    if (it.type !== TYPE_MAIN) continue;

    switch (it.tag) {
      case MAIN_COLLECTION: {
        const u = localUsages[0] ?? 0;
        // A 4-byte usage carries its own page in the high word.
        const page = u > 0xffff ? u >>> 16 : g.usagePage;
        if (depth === 0) {
          current = builder(page, u & 0xffff);
          children = [];
        } else if (current) {
          open.push(builder(page, u & 0xffff, children.length));
          children.push(build(open[open.length - 1]!));
        }
        depth++;
        break;
      }
      case MAIN_END_COLLECTION:
        depth = Math.max(0, depth - 1);
        if (depth > 0) {
          const child = open.pop();
          if (child) children[child.slot] = build(child);
        } else if (current) {
          const c = build(current);
          if (children.length) c.children = children;
          collections.push(c);
          current = null;
          open.length = 0;
        }
        break;
      case MAIN_INPUT:
        add('input', g.reportSize * g.reportCount);
        break;
      case MAIN_OUTPUT:
        add('output', g.reportSize * g.reportCount);
        break;
      case MAIN_FEATURE:
        add('feature', g.reportSize * g.reportCount);
        break;
    }
    localUsages = [];
  }
  return collections;
}

/** Human-readable dump (used by the device inspector and fixtures). */
export function describeCollections(collections: HidCollection[]): string[] {
  const fmt = (r: HidReportInfo[]) =>
    r.length ? r.map((x) => `id${x.reportId}:${x.size}B`).join(',') : '-';
  return collections.map(
    (c) =>
      `usagePage=0x${c.usagePage.toString(16).padStart(4, '0')} usage=0x${c.usage.toString(16).padStart(2, '0')} in=${fmt(c.inputReports)} out=${fmt(c.outputReports)} feature=${fmt(c.featureReports)}`,
  );
}
