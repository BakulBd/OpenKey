export type Vars = Record<string, string | number>;

/** Replaces {name} placeholders. Unknown placeholders are left visible so they get noticed. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
