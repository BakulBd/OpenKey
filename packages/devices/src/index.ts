import type { KeyboardLayout, TransportMode } from '@openkey/core';
import maxPlus from '../../../devices/ak820-max-plus.json' with { type: 'json' };
import pro from '../../../devices/ak820-pro.json' with { type: 'json' };
import proOnline from '../../../devices/ak820-pro-online.json' with { type: 'json' };
import maxCrs from '../../../devices/ak820-max-crs.json' with { type: 'json' };
import dongle from '../../../devices/ak820-dongle.json' with { type: 'json' };
import proQmk from '../../../devices/ak820-pro-qmk.json' with { type: 'json' };
import layoutMax from './layouts/ak820-max.json' with { type: 'json' };
import layoutPro from './layouts/ak820-pro.json' with { type: 'json' };
import layoutProOnline from './layouts/ak820-pro-online.json' with { type: 'json' };

export type ConfigurationSupport = 'supported' | 'partial' | 'unsupported' | 'unknown';

export interface ModelProfile {
  id: string;
  model: string;
  notes?: string;
  vendorIds: string[];
  productIds: string[];
  productNames: string[];
  firmwareRange: { min: string | null; max: string | null; tested: string[] };
  usagePages: string[];
  usages: Record<string, string[]>;
  protocolFamily: string;
  variant: string;
  layout: string;
  transportModes: Record<
    Exclude<TransportMode, 'unknown'>,
    { configuration: ConfigurationSupport; evidence: string }
  >;
  tft: {
    width: number;
    height: number;
    maxFrames: number | null;
    slots: number;
    headerBytes: number;
    chunkBytes: number | null;
    delayUnitMs: number;
  } | null;
  rgb: {
    brightnessMax: number;
    speedMax: number;
    defaultEffect: number | null;
    perKey: boolean;
  } | null;
  macros: { slots: number; storageBytes: number | null; eventBudgetBytes?: number } | null;
  knob: { configurable: boolean; note: string };
  evidence: string[];
}

export const PROFILES: readonly ModelProfile[] = [
  maxPlus,
  pro,
  proOnline,
  maxCrs,
  dongle,
  proQmk,
] as unknown as ModelProfile[];

export const LAYOUTS: Record<string, KeyboardLayout> = {
  'ak820-max': layoutMax as KeyboardLayout,
  'ak820-pro': layoutPro as KeyboardLayout,
  'ak820-pro-online': layoutProOnline as KeyboardLayout,
};

const hexNum = (s: string): number => parseInt(s, 16);

export function getProfile(id: string): ModelProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

export function getLayout(id: string): KeyboardLayout {
  const l = LAYOUTS[id];
  if (!l) throw new Error(`Unknown layout ${id}`);
  return l;
}

export interface ProfileMatch {
  profile: ModelProfile;
  score: number;
  reasons: string[];
}

/**
 * Static profile hints for a device. These only rank candidates; protocol probes and the device's
 * own answers always override them.
 */
export function matchProfiles(
  identity: { vendorId: number; productId: number; productName: string },
  usagePages: number[],
  protocolFamily?: string,
): ProfileMatch[] {
  const out: ProfileMatch[] = [];
  for (const p of PROFILES) {
    if (protocolFamily && p.protocolFamily !== protocolFamily) continue;
    const reasons: string[] = [];
    let score = 0;
    if (p.vendorIds.map(hexNum).includes(identity.vendorId)) {
      score += 1;
      reasons.push('vendor id');
    } else continue;
    if (p.productIds.map(hexNum).includes(identity.productId)) {
      score += 1;
      reasons.push('product id');
    }
    if (p.productNames.length) {
      if (p.productNames.includes(identity.productName)) {
        score += 3;
        reasons.push(`product string "${identity.productName}"`);
      } else {
        score -= 3;
      }
    }
    const pages = p.usagePages.map(hexNum);
    if (pages.length && pages.every((u) => usagePages.includes(u))) {
      score += 2;
      reasons.push('vendor usage pages');
    }
    if (score > 1) out.push({ profile: p, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
export * from './catalog.js';
