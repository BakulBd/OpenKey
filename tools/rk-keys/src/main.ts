/**
 * Builds packages/protocols/src/families/rk-classic/keys.json from the KB.ini files of RK's own
 * Windows software, for the models in the classic RK model list.
 *
 *   pnpm rk-keys <path to …/rk/Dev>
 *
 * The KB.ini files are RK's configuration as published in vinc3m1/kludgeknight (public/rk/Dev).
 * Only facts are kept: per key its rectangle on RK's keyboard picture, its Windows virtual-key code
 * and its index in the key-map and colour tables (`Kn=x1,y1,x2,y2, type,VK,0x00,index`), plus the
 * board's `RGBKb` flag. Every field is parsed as a number; nothing from the files is executed.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { RK_CLASSIC_MODELS } from '../../../packages/protocols/src/families/rk-classic/models.js';

const dev = process.argv[2];
if (!dev || !existsSync(dev)) {
  console.error('usage: pnpm rk-keys <path to rk/Dev>');
  process.exit(2);
}

function text(file: string): string {
  const raw = readFileSync(file);
  if (raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString('utf16le');
  return raw.toString('latin1');
}

const num = (s: string): number => {
  const n = Number(s.trim());
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`not a small integer: ${s}`);
  return n;
};

/** [x1, y1, x2, y2, vk, index] or, for a key of another type than 2, [..., type]. */
type Key = number[];
const out: Record<string, { rgb: boolean; keys: Key[] }> = {};
const folders = readdirSync(dev).filter((n) => /^[0-9a-fA-F]{4}$/.test(n));

for (const [pid] of RK_CLASSIC_MODELS) {
  const folder = folders.find((n) => parseInt(n, 16) === pid);
  const file = folder && path.join(dev, folder, 'KB.ini');
  if (!file || !existsSync(file)) throw new Error(`no KB.ini for ${pid.toString(16)}`);
  let section = '';
  let rgb = false;
  const keys: Key[] = [];
  for (const raw of text(file).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      section = line;
      continue;
    }
    if (section === '[OPT]' && /^RGBKb=/.test(line)) rgb = line.slice(6).trim() === '1';
    const m = section === '[KEY]' && /^K\d+=(.*)$/.exec(line);
    if (!m) continue;
    const f = m[1]!.split(',');
    if (f.length < 8) continue;
    const [x1, y1, x2, y2, type, vk, , index] = f.map(num);
    keys.push(
      type === 2 ? [x1!, y1!, x2!, y2!, vk!, index!] : [x1!, y1!, x2!, y2!, vk!, index!, type!],
    );
  }
  if (!keys.length) throw new Error(`no keys for ${pid.toString(16)}`);
  out[pid.toString(16).padStart(4, '0')] = { rgb, keys };
}

const target = 'packages/protocols/src/families/rk-classic/keys.json';
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`${Object.keys(out).length} models → ${target}`);

/**
 * BY Tech boards configured by RK's software (`Fw=1`): the same key table, plus the factory
 * functions of the FN1 and FN2 layers (`[FN1]`, `[FN2]`: `Kn=0x09,0x01,code` gives the BY Tech code,
 * `Kn=0x02,VK,0x00` a Windows key code), keyed by the matrix index of key `Kn`.
 */
const BY_TECH_FOLDERS = ['015e', '01af'];
const word = (s: string): number => {
  const n = Number(/^0x/i.test(s.trim()) ? s.trim() : parseInt(s.trim(), 10));
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
    throw new Error(`not a 32-bit integer: ${s}`);
  return n;
};
const byTech: Record<string, unknown> = {};
for (const id of BY_TECH_FOLDERS) {
  const folder = folders.find((n) => n.toLowerCase() === id);
  const file = folder && path.join(dev, folder, 'KB.ini');
  if (!file || !existsSync(file)) throw new Error(`no KB.ini for ${id}`);
  let section = '';
  let rgb = false;
  const keys: Key[] = [];
  const indexOf = new Map<number, number>();
  const direct: [number, number][] = [];
  const fn: Record<string, [number, number, number][]> = { '[FN1]': [], '[FN2]': [] };
  for (const raw of text(file).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      section = line;
      continue;
    }
    if (section === '[OPT]' && /^RGBKb=/.test(line)) rgb = line.slice(6).trim() === '1';
    const m = /^K(\d+)=(.*)$/.exec(line);
    if (!m) continue;
    const f = m[2]!.split(',').map((x) => x.trim());
    if (section === '[KEY]' && f.length >= 8) {
      const [x1, y1, x2, y2] = f.slice(0, 4).map(num);
      const type = word(f[4]!);
      const index = num(f[7]!);
      indexOf.set(Number(m[1]), index);
      if (type === 2) keys.push([x1!, y1!, x2!, y2!, num(f[5]!), index]);
      else if (type === 9) direct.push([index, word(f[6]!)]);
    } else if (fn[section] && f.length >= 3) {
      const index = indexOf.get(Number(m[1]));
      if (index === undefined) continue;
      const type = word(f[0]!);
      fn[section]!.push([index, type, type === 9 ? word(f[2]!) : word(f[1]!)]);
    }
  }
  byTech[id] = { rgb, keys, direct, fn1: fn['[FN1]'], fn2: fn['[FN2]'] };
}
const byTechTarget = 'packages/protocols/src/families/by-tech/rk-keys.json';
writeFileSync(byTechTarget, JSON.stringify(byTech) + '\n');
console.log(`${Object.keys(byTech).length} BY Tech models → ${byTechTarget}`);
