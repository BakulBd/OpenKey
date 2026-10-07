/**
 * Service-worker registration with user-controlled updates. The worker makes the *application*
 * available offline; it cannot make a keyboard reachable — WebHID still depends on the browser.
 */
let waiting: ServiceWorker | null = null;
let reloading = false;
const listeners = new Set<() => void>();

export function onUpdateReady(cb: () => void): () => void {
  listeners.add(cb);
  if (waiting) cb();
  return () => listeners.delete(cb);
}

export function applyUpdate(): void {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker(): void {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  void sw
    .register('./sw.js')
    .then((reg) => {
      const announce = () => {
        // Only an *update* needs a prompt; the first install just starts caching silently.
        if (reg.waiting && sw.controller) {
          waiting = reg.waiting;
          for (const l of listeners) l();
        }
      };
      announce();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed') announce();
        });
      });
      // Check for a new deployment when the tab regains focus (cheap: one small request).
      addEventListener('focus', () => void reg.update().catch(() => undefined));
    })
    .catch(() => undefined);
}
