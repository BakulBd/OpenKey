/**
 * What the connection itself allows. A keyboard reached through its 2.4 GHz receiver or over
 * Bluetooth often answers only some requests, or none; a keyboard whose writes are all unverified
 * needs the experimental switch; a keyboard with no write path is read-only. These helpers turn
 * that into one explanation the UI and the CLI show the same way.
 */
import type { ErrorExplanation } from './errors.js';
import { FEATURES } from './model/capabilities.js';
import type { Capabilities } from './model/capabilities.js';
import type { TransportMode } from './model/device.js';
import { writeDecision } from './safety.js';
import type { SafetyContext } from './safety.js';

const WIRELESS = new Set<TransportMode>(['2.4ghz', 'bluetooth']);
export const isWireless = (t: TransportMode): boolean => WIRELESS.has(t);

/** Errors that, on a wireless link, usually mean "asleep, out of range or not paired". */
const LINK_ERRORS = new Set([
  'TIMEOUT',
  'TRANSPORT',
  'DEVICE_DISCONNECTED',
  'MALFORMED_RESPONSE',
  'PROTOCOL',
]);

/** Rewrites the reason and the next step of an error for the link it happened on. */
export function explainForLink(x: ErrorExplanation, link: TransportMode): ErrorExplanation {
  if (!isWireless(link) || !LINK_ERRORS.has(x.kind)) return x;
  return link === '2.4ghz'
    ? {
        ...x,
        reason:
          'Through the 2.4 GHz receiver the keyboard answers only while it is awake, in range and paired with this receiver.',
        hint: 'Press a key to wake the keyboard and try again. For settings, plug in the USB cable and switch the keyboard to wired mode.',
      }
    : {
        ...x,
        reason: 'Over Bluetooth most keyboards offer typing only, with no settings channel.',
        hint: 'Plug in the USB cable and switch the keyboard to wired mode to configure it.',
      };
}

export type LinkLimit =
  /** Wireless link, and nothing can be written over it. */
  | 'wireless-read-only'
  /** Wireless link with some writes; the rest needs the cable. */
  | 'wireless-partial'
  /** Wired, but no feature has a write path (read-only adapter or locked firmware). */
  | 'read-only'
  /** Writes exist, but every one of them needs the experimental switch, which is off. */
  | 'experimental-only';

export interface LinkSummary {
  link: TransportMode;
  limits: LinkLimit[];
  /** Features that can be written right now. */
  writable: number;
  /** Features with a write path that needs the experimental switch. */
  experimental: number;
}

/** Summarises what can be done on this connection. Features the firmware lacks do not count. */
export function linkSummary(
  caps: Capabilities,
  link: TransportMode,
  ctx: SafetyContext,
): LinkSummary {
  let writable = 0;
  let experimental = 0;
  for (const f of FEATURES) {
    if (f === 'firmware' || f === 'factoryDefaults') continue;
    const d = writeDecision(caps[f], ctx);
    if (d.kind === 'allowed') writable++;
    else if (d.kind === 'experimental' && !ctx.experimentalEnabled) experimental++;
    else if (d.kind === 'experimental') writable++;
  }
  const limits: LinkLimit[] = [];
  if (isWireless(link))
    limits.push(writable || experimental ? 'wireless-partial' : 'wireless-read-only');
  else if (!writable && !experimental) limits.push('read-only');
  if (!writable && experimental) limits.push('experimental-only');
  return { link, limits, writable, experimental };
}
