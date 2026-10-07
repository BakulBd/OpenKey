import { useCallback, useEffect, useState } from 'react';

/**
 * Hash routing: every route survives a refresh on any static host without rewrite rules, and the
 * service worker only ever has to serve one HTML document.
 */
export function readRoute(): string {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';
}

export function useRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const h = () => setRoute(readRoute());
    addEventListener('hashchange', h);
    return () => removeEventListener('hashchange', h);
  }, []);
  const go = useCallback((r: string) => {
    location.hash = r === 'home' ? '/' : `/${r}`;
  }, []);
  return [route, go];
}

export function href(route: string): string {
  return route === 'home' ? '#/' : `#/${route}`;
}
