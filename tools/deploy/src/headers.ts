/**
 * One source of truth for HTTP headers: vercel.json. Other hosts get generated or checked copies
 * (Netlify / Cloudflare Pages `_headers`, nginx snippet), so a header cannot exist on one host and
 * be missing on another.
 */
export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/** Vercel path patterns (`/(.*)`, `/assets/(.*)`) as `_headers` patterns (`/*`, `/assets/*`). */
export function toSplatPattern(source: string): string {
  return source.replace(/\(\.\*\)/g, '*');
}

/** Netlify and Cloudflare Pages `_headers` file. */
export function headersFile(rules: HeaderRule[]): string {
  return (
    rules.map((r) => [toSplatPattern(r.source), ...r.headers.map((h) => `  ${h.key}: ${h.value}`)].join('\n')).join('\n\n') + '\n'
  );
}

/** Headers every response gets (the catch-all rule). */
export function globalHeaders(rules: HeaderRule[]): { key: string; value: string }[] {
  return rules.find((r) => r.source === '/(.*)')?.headers ?? [];
}

/** nginx `add_header` lines for the global headers (`always`, so error pages carry them too). */
export function nginxSecurityHeaders(rules: HeaderRule[]): string {
  return globalHeaders(rules)
    .map((h) => `add_header ${h.key} "${h.value.replace(/"/g, '\\"')}" always;`)
    .join('\n');
}
