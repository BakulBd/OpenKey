import { describe, expect, it } from 'vitest';
import { detectOs, isMobileOs, webHidCapableOs } from '../../apps/web/src/lib/platform.js';

const ua = {
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
};

describe('OS detection', () => {
  it('reads the user agent (Android and ChromeOS are not desktop Linux; iOS is not macOS)', () => {
    for (const [os, s] of Object.entries(ua)) expect(detectOs({ userAgent: s }), os).toBe(os);
  });
  it('prefers client hints when present', () => {
    expect(detectOs({ userAgent: ua.linux, userAgentData: { platform: 'Windows' } })).toBe('windows');
  });
  it('knows where WebHID can exist', () => {
    expect(webHidCapableOs('linux')).toBe(true);
    expect(webHidCapableOs('android')).toBe(false);
    expect(isMobileOs('ios')).toBe(true);
  });
});
