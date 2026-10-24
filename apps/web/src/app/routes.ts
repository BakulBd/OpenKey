import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { navigationMode } from '@openkey/core';
import type { Capabilities, FeatureId } from '@openkey/core';
import type { IconName } from '../components/Icon.js';
import type { MessageKey } from '../i18n/i18n.js';

export interface RouteDef {
  id: string;
  section: 'device' | 'workspace' | 'tools';
  label: MessageKey;
  icon: IconName;
  /** Device routes: shown when any of these features is usable (or as research when present). */
  features?: FeatureId[];
  /** Needs a configurable (non-unknown) device session. */
  needsDevice?: boolean;
  /** Reachable by URL (old links, deep links) but not listed in the navigation. */
  hidden?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

// Every page is a separate chunk: the landing page does not pay for the TFT pipeline or the lab.
export const ROUTES: RouteDef[] = [
  {
    id: 'overview',
    section: 'device',
    label: 'nav.overview',
    icon: 'overview',
    component: lazy(() => import('../features/overview/Overview.js')),
  },
  {
    id: 'keymap',
    section: 'device',
    label: 'nav.keymap',
    icon: 'keymap',
    features: ['keymap', 'fnLayer'],
    needsDevice: true,
    component: lazy(() => import('../features/keymap/KeymapStudio.js')),
  },
  // Effects and per-key colour are one workspace: applying per-key colours switches the effect.
  {
    id: 'rgb',
    section: 'device',
    label: 'nav.rgb',
    icon: 'rgb',
    features: ['rgb', 'perKeyRgb', 'lightZones'],
    needsDevice: true,
    component: lazy(() => import('../features/rgb/Lighting.js')),
  },
  {
    id: 'perkey',
    section: 'device',
    label: 'nav.perkey',
    icon: 'paint',
    features: ['perKeyRgb'],
    needsDevice: true,
    hidden: true,
    component: lazy(() => import('../features/rgb/Lighting.js')),
  },
  {
    id: 'macros',
    section: 'device',
    label: 'nav.macros',
    icon: 'macros',
    features: ['macros'],
    needsDevice: true,
    component: lazy(() => import('../features/macros/MacroStudio.js')),
  },
  {
    id: 'screen',
    section: 'device',
    label: 'nav.screen',
    icon: 'screen',
    features: ['tft', 'tftGif', 'tftClock', 'tftBuiltIn'],
    needsDevice: true,
    component: lazy(() => import('../features/tft/TftStudio.js')),
  },
  {
    id: 'custom',
    section: 'device',
    label: 'nav.custom',
    icon: 'settings',
    features: ['customMenus'],
    needsDevice: true,
    component: lazy(() => import('../features/custom/CustomMenus.js')),
  },
  {
    id: 'mouse',
    section: 'device',
    label: 'nav.mouse',
    icon: 'device',
    features: ['debounce', 'pollingRate'],
    needsDevice: true,
    component: lazy(() => import('../features/mouse/MouseSettings.js')),
  },
  {
    id: 'actuation',
    section: 'device',
    label: 'nav.actuation',
    icon: 'latency',
    features: ['actuation', 'rapidTrigger'],
    needsDevice: true,
    component: lazy(() => import('../features/actuation/ActuationStudio.js')),
  },
  {
    id: 'vial',
    section: 'device',
    label: 'nav.vial',
    icon: 'layers',
    features: ['firmwareSettings', 'advancedKeys'],
    needsDevice: true,
    component: lazy(() => import('../features/vial/VialStudio.js')),
  },
  {
    id: 'settings-device',
    section: 'device',
    label: 'nav.deviceSettings',
    icon: 'device',
    needsDevice: true,
    component: lazy(() => import('../features/device/DeviceSettings.js')),
  },
  {
    id: 'backup',
    section: 'device',
    label: 'nav.backup',
    icon: 'backup',
    needsDevice: true,
    component: lazy(() => import('../features/backup/BackupRestore.js')),
  },
  {
    id: 'profiles',
    section: 'workspace',
    label: 'nav.profiles',
    icon: 'profiles',
    component: lazy(() => import('../features/profiles/Profiles.js')),
  },
  {
    id: 'tester',
    section: 'tools',
    label: 'nav.tester',
    icon: 'tester',
    component: lazy(() => import('../features/tester/Tester.js')),
  },
  {
    id: 'latency',
    section: 'tools',
    label: 'nav.latency',
    icon: 'latency',
    component: lazy(() => import('../features/latency/LatencyLab.js')),
  },
  {
    id: 'lab',
    section: 'tools',
    label: 'nav.lab',
    icon: 'lab',
    component: lazy(() => import('../features/lab/ResearchLab.js')),
  },
  {
    id: 'doctor',
    section: 'tools',
    label: 'nav.doctor',
    icon: 'doctor',
    component: lazy(() => import('../features/doctor/Doctor.js')),
  },
  {
    id: 'compat',
    section: 'tools',
    label: 'nav.compat',
    icon: 'compat',
    component: lazy(() => import('../features/compat/Compatibility.js')),
  },
  {
    id: 'settings',
    section: 'tools',
    label: 'nav.settings',
    icon: 'settings',
    component: lazy(() => import('../features/settings/Settings.js')),
  },
];

export type RouteVisibility = 'show' | 'research' | 'hide';

/**
 * Adaptive navigation: a device page appears only when the connected keyboard can use it. A feature
 * that exists on the hardware but whose protocol is unknown is shown as "research needed", never
 * hidden as if the hardware did not exist.
 */
export function routeVisibility(
  r: RouteDef,
  caps: Capabilities | null,
  hasDevice: boolean,
  hasSession: boolean,
): RouteVisibility {
  if (r.section !== 'device') return 'show';
  if (r.id === 'overview') return hasSession ? 'show' : 'hide';
  if (r.needsDevice && !hasDevice) return 'hide';
  if (!r.features || !caps) return 'show';
  const modes = r.features.map((f) => navigationMode(caps[f]));
  if (modes.includes('show')) return 'show';
  if (modes.includes('research')) return 'research';
  return 'hide';
}
