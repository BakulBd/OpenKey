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
