import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fromHex } from '@openak820/core';

export const ROOT = path.resolve(import.meta.dirname, '..');

export function fixture<T = Record<string, unknown>>(rel: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, 'fixtures', rel), 'utf8')) as T;
}

export function hex(s: string): Uint8Array {
  return fromHex(s);
}

export function readRe(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(ROOT, 're', rel)));
}

/** No-op sleep so protocol timing does not slow tests down. */
export const noSleep = async (): Promise<void> => undefined;
