/**
 * Builds packages/protocols/src/families/by-tech/rk-web.json from RK's own web driver bundle
 * (drive.rkgaming.com, `assets/index-*.js`), for the boards it drives with the BY Tech ("BeiYing")
 * protocol over USB.
 *
 *   pnpm rk-web <path to the downloaded index-*.js>
 *
 * Facts only: per board its name, USB product ID, effect numbers, and the factory code of every
 * matrix position on the normal, FN1, FN2 and tap layers (Windows table). A board is kept only when
 * its own protocol module confirms what OpenKey writes: a 6 × 21 key matrix (read 0x83, write 0x03),
 * a 3 × 126 colour table (read 0x86, write 0x06) and 519-byte reports. The bundle is read as text;
 * nothing in it is executed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: pnpm rk-web <path to index-*.js>');
  process.exit(2);
}
const s = readFileSync(file, 'utf8');

/** Every enum that starts with `NONE=0`, by variable, with its position. */
const enums = new Map<string, { at: number; members: Map<string, number> }[]>();
for (const m of s.matchAll(/[,;\s(]([\w$]+)=\(e=>\(e\[e\.NONE=0\]/g)) {
  const name = m[1]!;
  const at = m.index! + 1;
  const end = s.indexOf(`(${name}||{})`, at);
  if (end < 0) continue;
  const members = new Map<string, number>();
  for (const e of s.slice(at, end).matchAll(/e\[e\.(\w+)=(-?\d+)\]/g))
    members.set(e[1]!, Number(e[2]));
  enums.set(name, [...(enums.get(name) ?? []), { at, members }]);
}
const enumAt = (name: string, pos: number) => {
  const list = enums.get(name) ?? [];
  return [...list].reverse().find((e) => e.at < pos)?.members ?? list[0]?.members;
};

const escape = (v: string) => v.replace(/\$/g, '\\$');
/** The nearest definition `name=` before `pos`. */
function lastDef(name: string, pos: number, suffix = ''): number {
  const re = new RegExp(`[,;\\s]${escape(name)}=${suffix}`, 'g');
  let at = -1;
  for (const m of s.slice(0, pos).matchAll(re)) at = m.index! + 1;
  return at;
}
function array(name: string, pos: number): (number | undefined)[] | null {
  const at = lastDef(name, pos, '\\[');
  if (at < 0) return null;
  const start = s.indexOf('[', at);
  const end = s.indexOf(']', start);
  return [...s.slice(start, end).matchAll(/([\w$]+)\.(\w+)/g)].map((m) =>
    enumAt(m[1]!, start)?.get(m[2]!),
  );
}
function constant(name: string, pos: number): number | null {
  const at = lastDef(name, pos);
  if (at < 0) return null;
  const v = /^(\d+)/.exec(s.slice(at + name.length + 1, at + name.length + 12));
  return v ? Number(v[1]) : null;
}
/** What the board's own protocol module reads and writes. */
function protocolFacts(cls: string, pos: number) {
  const from = Math.max(0, pos - 400_000);
  const defs = [...s.slice(from, pos).matchAll(new RegExp(`[,;\\s]${escape(cls)}=class`, 'g'))];
  const anchor = defs.length ? from + defs.at(-1)!.index! : pos;
  const base = Math.max(0, anchor - 60_000);
  const seg = s.slice(base, anchor + 8_000);
  const last = (re: RegExp) => [...seg.matchAll(re)].at(-1);
  const km = last(/super\(131\);.{0,400}?this\.dataLength=([\w$]+)\*([\w$]+)\*4/g);
  const lc = last(/super\(134\);.{0,300}?this\.dataLength=([\w$]+)\*([\w$]+)/g);
  const rep = last(/new Uint8Array\((\d+)\),this\.setReport\[0\]=this\.cmdId/g);
  return {
    matrix: km ? [constant(km[1]!, base + km.index!), constant(km[2]!, base + km.index!)] : null,
    colors: lc ? [constant(lc[1]!, base + lc.index!), constant(lc[2]!, base + lc.index!)] : null,
    report: rep ? Number(rep[1]) : null,
    setMatrix: /super\(3\);.{0,200}?dataLength=/.test(seg),
    setColors: /super\(6\);/.test(seg),
  };
}
const EFFECTS: Record<string, number> = {
  OFF: 0,
  FixedOn: 1,
  Respire: 2,
  Rainbow: 3,
  FlashAway: 4,
  Raindrops: 5,
  RainbowWheel: 6,
  RippleShining: 7,
  StarsTwinkle: 8,
  ShadowDisappear: 9,
  RetroSnake: 10,
  NeonStream: 11,
  Reaction: 12,
  SineWave: 13,
  SideScan: 14,
  RotatingWindmill: 15,
  ColorfulWaterfall: 16,
  Blossoming: 17,
  SelfDefine: 18,
  Music: 19,
};

const out: Record<string, { name: string; effects: number[]; tables: number[][] }> = {};
const skipped: string[] = [];
const device =
  /\{name:"([^"]+)",(?:image:"[^"]*",)?vendorId:(\d+),productId:(\d+),usagePage:(\d+),usage:(\d+),connectType:[\w$]+\.(\w+),deviceType:[\w$]+\.(\w+),protocolType:[\w$]+\.(\w+)(.{0,900})/g;
for (const m of s.matchAll(device)) {
  const [, name, vid, pid, , , conn, type, proto, rest] = m;
  if (proto !== 'BeiYing' || conn !== 'USB' || type !== 'Keyboard' || Number(vid) !== 0x258a)
    continue;
  const key = Number(pid).toString(16).padStart(4, '0');
  if (out[key]) continue;
  const layers = /keyLayout:\{0:\{0:([\w$]+),1:([\w$]+),2:([\w$]+),3:([\w$]+)/.exec(rest!);
  const cls = /protocol:([\w$]+)\.create/.exec(rest!);
  if (!layers || !cls) continue;
  const tables = layers.slice(1).map((v) => array(v, m.index!));
  if (tables.some((t) => !t || t.length < 126 || t.slice(0, 126).some((c) => c === undefined))) {
    skipped.push(`${name} (${key}): a factory table uses codes outside the known enums`);
    continue;
  }
  const f = protocolFacts(cls[1]!, m.index!);
  const ok =
    f.matrix?.join('x') === '6x21' &&
    f.colors?.join('x') === '3x126' &&
    f.report === 519 &&
    f.setMatrix &&
    f.setColors;
  if (!ok) {
    skipped.push(`${name} (${key}): protocol module not confirmed (${JSON.stringify(f)})`);
    continue;
  }
  const le = /lightEffects:([\w$]+)/.exec(rest!);
  let effects: number[] = [];
  if (le) {
    const at = lastDef(le[1]!, m.index!, '\\[');
    const end = s.indexOf('}]', at);
    effects = [...s.slice(at, end).matchAll(/effect:[\w$]+\.(\w+)/g)]
      .map((e) => EFFECTS[e[1]!])
      .filter((e): e is number => e !== undefined);
  }
  out[key] = {
    name: name!,
    effects,
    tables: tables.map((t) => (t as number[]).slice(0, 126).map((c) => c >>> 0)),
  };
}

const target = 'packages/protocols/src/families/by-tech/rk-web.json';
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`${Object.keys(out).length} boards → ${target}`);
for (const x of skipped) console.log(`  skipped ${x}`);
