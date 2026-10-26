/**
 * Builds packages/protocols/src/families/hub-aa55/web-boards.json from AJAZZ's own web driver bundle
 * (ajazz.driveall.cn, `assets/layout-classic-*.js`): every USB board configuration it ships.
 *
 *   pnpm ajazz-web <path to the downloaded layout-classic-*.js>
 *
 * Facts only: per board its USB identity and product name (the web driver's own key), the pages it
 * offers, brightness and speed ranges, Fn-layer rules, and its key rows (key number, HID usage, name,
 * layout class). The bundle is read as text; nothing in it is executed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: pnpm ajazz-web <path to layout-classic-*.js>');
  process.exit(2);
}
const s = readFileSync(file, 'utf8');

const num = (re: RegExp, seg: string): number | undefined => {
  const m = re.exec(seg);
  return m ? Number(m[1]) : undefined;
};
const flag = (name: string, seg: string) => new RegExp(`${name}:!0`).test(seg);

interface Board {
  vendorId: number;
  productId: number;
  name: string;
  routes: string[];
  fn: boolean;
  fnDisabled: number[];
  brightness?: [number, number];
  speed?: [number, number];
  macroSpace: boolean;
  rows: [number, number, string, string][][];
}

const out: Board[] = [];
const starts = [...s.matchAll(/\{vendorId:(\d+),productId:(\d+),supplierName:/g)];
for (const [i, m] of starts.entries()) {
  const from = m.index!;
  const next = s.indexOf('keyboardConfig:()=>', from + 10);
  const until = starts[i + 1]?.index ?? s.length;
  const seg = s.slice(from, Math.min(next > 0 ? next : until, until));
  if (!/connectType:`USB`/.test(seg)) continue;
  const name = /name:`([^`]*)`/.exec(seg)?.[1] ?? '';
  const routes = (/routesName:\[([^\]]*)\]/.exec(seg)?.[1] ?? '')
    .split(',')
    .map((r) => r.replace(/`/g, '').trim())
    .filter(Boolean);
  const kl = seg.indexOf('keyList:[[');
  if (kl < 0) continue;
  const end = seg.indexOf(']]', kl);
  const rows = seg
    .slice(kl + 10, end)
    .split('],[')
    .map((row) =>
      [...row.matchAll(/className:`([^`]*)`,value:(\d+),name:`([^`]*)`,keyCode:(\d+)/g)].map(
        (k): [number, number, string, string] => [Number(k[2]), Number(k[4]), k[3]!, k[1]!.trim()],
      ),
    )
    .filter((r) => r.length);
  if (!rows.length) continue;
  const light = /lightingConfig:\{([^}]*)\}/.exec(seg)?.[1] ?? '';
  const minB = num(/minBrightness:(\d+)/, light);
  const maxB = num(/maxBrightness:(\d+)/, light);
  const minS = num(/minSpeed:(\d+)/, light);
  const maxS = num(/maxSpeed:(\d+)/, light);
  const ck = /customKeysConfig:\{([^}]*)\}/.exec(seg)?.[1] ?? '';
  out.push({
    vendorId: Number(m[1]),
    productId: Number(m[2]),
    name,
    routes,
    fn: flag('isShowFn', ck),
    fnDisabled: (/fnDisabledKeyIds:\[([^\]]*)\]/.exec(ck)?.[1] ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number),
    ...(maxB !== undefined ? { brightness: [minB ?? 0, maxB] as [number, number] } : {}),
    ...(maxS !== undefined ? { speed: [minS ?? 0, maxS] as [number, number] } : {}),
    macroSpace: flag('isGetMaxMacroSpaceSize', seg),
    rows,
  });
}

// One entry per identity and product name, as the web driver keys them.
const seen = new Set<string>();
const boards = out.filter((b) => {
  if (!b.vendorId || !b.productId) return false; // template entries
  const key = `${b.vendorId}:${b.productId}:${b.name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const target = 'packages/protocols/src/families/hub-aa55/web-boards.json';
writeFileSync(target, JSON.stringify(boards) + '\n');
// The identities alone, small enough to load with the adapter (detection is synchronous).
writeFileSync(
  'packages/protocols/src/families/hub-aa55/web-index.json',
  JSON.stringify(boards.map((b) => [b.vendorId, b.productId, b.name])) + '\n',
);
console.log(`${boards.length} USB boards → ${target}`);
