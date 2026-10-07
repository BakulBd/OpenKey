import { getProfile } from '@openak820/profiles';
import type { ModelProfile } from '@openak820/profiles';

export interface SonixFeatureVariant {
  id: string;
  profile: ModelProfile;
  /** True when the product string matched a known model; false for the generic fallback. */
  known: boolean;
}

const BY_PRODUCT: Record<string, string> = {
  'AK820 MAX': 'ak820-max-plus',
  AK820: 'ak820-pro',
};

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
