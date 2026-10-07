import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Capture, CapturePacket } from './diff.js';

const hexToBytes = (h: string): number[] =>
  h
    .replace(/[^0-9a-f]/gi, '')
    .match(/../g)
    ?.map((x) => parseInt(x, 16)) ?? [];

/**
 * Accepts:
 * - OpenKey experiment files (tools/capture) `{ packets: [{direction, kind, hex}] }`
 * - OpenKey packet logs (`openkey … --json` → `packets` / PacketLog.toJSON())
 * - fixture files with `packets: [{kind, hex}]`
 * - plain text: one hex packet per line, optional `>`/`<` prefix for direction
 */
export async function loadCapture(file: string): Promise<Capture> {
  const text = await fs.readFile(file, 'utf8');
  const name = path.basename(file);
  try {
    const j = JSON.parse(text) as { packets?: unknown[] } | unknown[];
    const list = (Array.isArray(j) ? j : (j.packets ?? [])) as {
      direction?: string;
      kind?: string;
      hex: string;
    }[];
    const packets: CapturePacket[] = list.map((p) => ({
      direction:
        p.direction === 'device->host' || p.kind === 'feature-get' || p.kind === 'input'
          ? 'device->host'
          : 'host->device',
      kind: p.kind ?? 'unknown',
      bytes: hexToBytes(p.hex),
    }));
    return { name, packets };
  } catch {
    const packets: CapturePacket[] = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => ({
        direction: l.startsWith('<') ? 'device->host' : 'host->device',
        kind: 'line',
        bytes: hexToBytes(l.replace(/^[<>]\s*/, '')),
      }));
    return { name, packets };
  }
}
