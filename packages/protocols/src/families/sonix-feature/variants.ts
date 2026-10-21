import { getProfile } from '@openkey/devices';
import type { ModelProfile } from '@openkey/devices';
import type { TftGeometry } from '@openkey/core';

export interface SonixFeatureVariant {
  id: string;
  profile: ModelProfile;
  /** True when the product string matched a known model; false for the generic fallback. */
  known: boolean;
}

const BY_PRODUCT: Record<string, string> = {
  'AK820 MAX': 'ak820-max-plus',
  AK820: 'ak820-pro',
  'AULA F108Pro': 'aula-f108-pro',
  'AULA-NOVA75': 'aula-nova75',
};

/**
 * Screens of the boards that share this protocol. A keyboard whose product string is not known
 * (generic strings such as "USB KEYBOARD", or new models) must have its screen size chosen before an
 * upload: sending the wrong size garbles the picture, and too many frames can overwrite the
 * keyboard's own menu graphics (F108 Pro, 141 frames; NOVA75, 107).
 */
export const SCREEN_CHOICES: readonly TftGeometry[] = [
  {
    id: '128x128',
    label: '128 × 128 — AK820 MAX / Pro, AKS075, AULA F75 Max',
    width: 128,
    height: 128,
    maxFrames: 140,
  },
  {
    id: '240x135',
    label: '240 × 135 — AULA F108 Pro, NOVA75, AK35i V3 MAX',
    width: 240,
    height: 135,
    // The smallest cap among these boards (NOVA75: 107; F108 Pro: 141), so no choice overruns one.
    maxFrames: 107,
  },
];

/**
 * PID 0x8009 is a generic Sonix PID shared by many AJAZZ boards (AK820, AK980 PRO, NS87 …), so the
 * USB product string – the same key the official drivers use – selects the model parameters.
 */
export function resolveVariant(productName: string): SonixFeatureVariant {
  const id = BY_PRODUCT[productName.trim()];
  const profile = id ? getProfile(id) : undefined;
  if (profile) return { id: profile.variant, profile, known: true };
  return { id: 'generic', profile: getProfile('ak820-max-plus')!, known: false };
}
