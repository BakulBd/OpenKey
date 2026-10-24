import { SafetyBlockedError } from './errors.js';
import type { KeyboardDriver } from './driver.js';
import type { FeatureId } from './model/capabilities.js';
import { mayWrite, writeDecision } from './safety.js';
import type { SafetyContext } from './safety.js';

/**
 * Every driver method that changes the device, and the capabilities whose write policy governs it.
 * A method listed with several features is allowed only when all of them allow the write.
 * Adapter-specific extras (e.g. `streamRealtime`) are listed too; unknown methods are not writes.
 */
export const WRITE_METHODS: Readonly<Record<string, readonly FeatureId[]>> = {
  setKeymap: ['keymap'],
  setFnLayer: ['fnLayer'],
  setFnLayers: ['fnLayer'],
  setMacros: ['macros'],
  setRgbConfig: ['rgb'],
  setPerKeyRgb: ['perKeyRgb'],
  setLightZones: ['lightZones'],
  streamRealtime: ['realtimeRgb'],
  uploadTftImage: ['tft'],
  uploadTftGif: ['tftGif'],
  setTftMode: ['tft'],
  syncClock: ['tftClock'],
  setPollingRate: ['pollingRate'],
  setSystemSettings: ['sleep', 'keyResponse', 'winLock', 'altLocks'],
  setSleepConfig: ['sleep'],
  setGameMode: ['gameMode'],
  setKeyResponse: ['keyResponse'],
  setWinLock: ['winLock'],
  setEncoder: ['encoder'],
  restoreDefaults: ['factoryDefaults'],
};

/**
 * Wraps a driver so that every write passes the same policy as the web UI (`writeDecision`),
 * whatever front end calls it. The context is read at call time, so a per-session opt-in applies
 * immediately and is never cached. Reads pass through untouched.
 */
export function guardWrites<D extends KeyboardDriver>(driver: D, context: () => SafetyContext): D {
  return new Proxy(driver, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      const features = typeof prop === 'string' ? WRITE_METHODS[prop] : undefined;
      if (!features || typeof value !== 'function') return value;
      // Every write method is async, so a refusal is a rejected promise, never a synchronous throw.
      return async (...args: unknown[]) => {
        const caps = target.getCapabilities();
        const ctx = context();
        for (const f of features) {
          const decision = writeDecision(caps[f], ctx);
          // Features the driver does not write at all are skipped for multi-feature methods, so a
          // settings packet is judged by the settings it actually carries.
          if (features.length > 1 && !caps[f].write) continue;
          if (decision.kind === 'blocked')
            throw new SafetyBlockedError(`${String(prop)} (${f}) is blocked: ${decision.reason}`, {
              feature: f,
              decision: decision.kind,
            });
          if (!mayWrite(decision, ctx))
            throw new SafetyBlockedError(
              `${String(prop)} (${f}) is experimental: ${decision.kind === 'experimental' ? decision.reason : ''} Enable experimental writes to proceed.`,
              { feature: f, decision: decision.kind },
            );
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
