/** Operating system, as far as the browser reveals it. Used to explain, never to decide what works. */
export type OsName = 'linux' | 'windows' | 'macos' | 'chromeos' | 'android' | 'ios' | 'other';

export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  userAgentData?: { platform?: string; mobile?: boolean };
}

export function detectOs(nav: NavigatorLike): OsName {
  const hint = (nav.userAgentData?.platform ?? '').toLowerCase();
  const ua = nav.userAgent;
  if (hint === 'chrome os' || hint === 'chromeos' || /CrOS/.test(ua)) return 'chromeos';
  if (hint === 'android' || /Android/.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (hint === 'macos' || /Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (hint === 'windows' || /Windows/.test(ua)) return 'windows';
  if (hint === 'linux' || /Linux|X11/.test(ua)) return 'linux';
  return 'other';
}

export function isMobileOs(os: OsName): boolean {
  return os === 'android' || os === 'ios';
}

/** Desktop systems where Chromium browsers implement WebHID. */
export function webHidCapableOs(os: OsName): boolean {
  return os === 'linux' || os === 'windows' || os === 'macos' || os === 'chromeos';
}

export function currentOs(): OsName {
  return typeof navigator === 'undefined' ? 'other' : detectOs(navigator as NavigatorLike);
}
