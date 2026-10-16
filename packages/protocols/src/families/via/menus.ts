/**
 * VIA v3 custom menus: the controls a keyboard's definition declares (lighting, knob modes, keyboard
 * features). Each control is bound to a [token, channel, value id, …extra] command; the value is read
 * with id_custom_get_value, written with id_custom_set_value and committed with id_custom_save per
 * channel. Facts from the-via/reader menu-types.ts and the-via/app (GPL-3.0; facts only).
 *
 * Definitions are data. `showIf` expressions are parsed by the small grammar below (numbers, {token}
 * references, comparisons, && || ! and parentheses); nothing is ever passed to eval or Function.
 */

export type MenuControlType =
  'range' | 'toggle' | 'dropdown' | 'color' | 'keycode' | 'button' | 'label' | 'text';

export interface MenuControl {
  type: MenuControlType;
  label: string;
  /** Token that showIf expressions refer to, e.g. "id_qmk_rgb_matrix_effect". */
  token: string | null;
  /** [channel, value id, …extra]; null for text. */
  command: number[] | null;
  /** Range [min, max]; toggle [off, on] values; dropdown choices as [label, value]. */
  range?: [number, number];
  toggle?: [number[], number[]];
  choices?: [string, number][];
  /** Value byte count (color and keycode: 2). */
  bytes: number;
  unit?: string;
  showIf?: string;
}

export interface MenuSection {
  label: string;
  showIf?: string;
  controls: MenuControl[];
}

export interface CustomMenu {
  label: string;
  showIf?: string;
  sections: MenuSection[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const cond = (v: Record<string, unknown>) =>
  typeof v.showIf === 'string' ? { showIf: v.showIf } : {};
const bytes = (v: number | number[]) => (Array.isArray(v) ? v : [v]);

function control(item: Record<string, unknown>): MenuControl | null {
  const type = item.type;
  const label = str(item.label);
  if (type === undefined && typeof item.content === 'string')
    return {
      type: 'text',
      label: item.content || label,
      token: null,
      command: null,
      bytes: 0,
      ...cond(item),
    };
  const known = ['range', 'toggle', 'dropdown', 'color', 'keycode', 'button', 'label'];
  if (typeof type !== 'string' || !known.includes(type)) return null;
  const content = Array.isArray(item.content) ? item.content : null;
  const bound =
    content &&
    typeof content[0] === 'string' &&
    content.slice(1).length >= 2 &&
    content.slice(1).every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (type === 'label' && !bound)
    return { type: 'text', label, token: null, command: null, bytes: 0, ...cond(item) };
  if (!bound) return null;
  const c: MenuControl = {
    type: type as MenuControlType,
    label,
    token: content[0] as string,
    command: content.slice(1) as number[],
    bytes: type === 'color' || type === 'keycode' ? 2 : 1,
    ...cond(item),
  };
  const options = Array.isArray(item.options) ? item.options : [];
  if (type === 'range') {
    const [min, max] = options.map(Number);
    c.range = [Number.isFinite(min) ? min! : 0, Number.isFinite(max) ? max! : 255];
    c.bytes = c.range[1] > 255 ? 2 : 1;
    if (typeof item.unit === 'string') c.unit = item.unit;
  } else if (type === 'toggle') {
    const off = options[0] ?? 0;
    const on = options[1] ?? 1;
    c.toggle = [bytes(off as number | number[]), bytes(on as number | number[])];
    c.bytes = Math.max(c.toggle[0].length, c.toggle[1].length);
  } else if (type === 'dropdown') {
    c.choices = options.map((o, i): [string, number] =>
      Array.isArray(o) ? [String(o[0]), Number(o[1] ?? i)] : [String(o), i],
    );
  } else if (type === 'button') {
    c.toggle = [[], bytes((options[0] ?? 1) as number | number[])];
  }
  if (typeof item.bytes === 'number' && item.bytes >= 1 && item.bytes <= 4 && type !== 'color')
    c.bytes = item.bytes;
  return c;
}

/** Collects controls from nested groups (a group is an object whose content is an array). */
function controls(content: unknown, inherited?: string): MenuControl[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): MenuControl[] => {
    if (!isObj(item)) return [];
    const own = typeof item.showIf === 'string' ? item.showIf : undefined;
    const showIf = inherited && own ? `(${inherited}) && (${own})` : (inherited ?? own);
    if (item.type === undefined && Array.isArray(item.content))
      return controls(item.content, showIf);
    const c = control(item);
    return c ? [{ ...c, ...(showIf ? { showIf } : {}) }] : [];
  });
}

/** The custom menus of a definition (built-in menu names such as "qmk_rgb_matrix" are skipped). */
export function parseMenus(menus: unknown): CustomMenu[] {
  if (!Array.isArray(menus)) return [];
  return menus.filter(isObj).map((m) => ({
    label: str(m.label) || 'Settings',
    ...cond(m),
    sections: (Array.isArray(m.content) ? m.content : []).filter(isObj).map((s) => ({
      label: str(s.label),
      ...cond(s),
      controls: controls(s.content),
    })),
  }));
}

// ---------------------------------------------------------------- showIf

type Tok = { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) i++;
    else if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new Error('unclosed {');
      out.push({ t: 'ref', v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[0-9]/.test(ch)) {
      const m = /^(0x[0-9a-f]+|\d+(\.\d+)?)/i.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if ('<>!()+-*/%'.includes(ch)) {
        out.push({ t: 'op', v: ch });
        i++;
      } else throw new Error(`unexpected ${ch}`);
    }
  }
  return out;
}

/**
 * Evaluates a showIf expression against the current values (token → number). Unknown tokens count as
 * 0; an expression that does not parse shows the control, so nothing silently disappears.
 */
export function evalShowIf(expr: string | undefined, values: Record<string, number>): boolean {
  if (!expr) return true;
  let toks: Tok[];
  try {
    toks = tokenize(expr);
  } catch {
    return true;
  }
  let p = 0;
  const peek = () => toks[p];
  const eat = (v: string) => {
    const t = toks[p];
    if (t?.t === 'op' && t.v === v) {
      p++;
      return true;
    }
    return false;
  };
  const prec: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  };
  const apply = (op: string, a: number, b: number): number => {
    switch (op) {
      case '||':
        return a || b ? 1 : 0;
      case '&&':
        return a && b ? 1 : 0;
      case '==':
        return a === b ? 1 : 0;
      case '!=':
        return a !== b ? 1 : 0;
      case '<':
        return a < b ? 1 : 0;
      case '<=':
        return a <= b ? 1 : 0;
      case '>':
        return a > b ? 1 : 0;
      case '>=':
        return a >= b ? 1 : 0;
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b ? a / b : 0;
      default:
        return b ? a % b : 0;
    }
  };
  const unary = (): number => {
    if (eat('!')) return unary() ? 0 : 1;
    if (eat('-')) return -unary();
    if (eat('(')) {
      const v = binary(0);
      if (!eat(')')) throw new Error('missing )');
      return v;
    }
    const t = toks[p++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') return t.v;
    if (t.t === 'ref') return values[t.v] ?? 0;
    throw new Error(`unexpected ${t.v}`);
  };
  const binary = (min: number): number => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t?.t !== 'op' || !(t.v in prec) || prec[t.v]! < min) return left;
      p++;
      left = apply(t.v, left, binary(prec[t.v]! + 1));
    }
  };
  try {
    const v = binary(0);
    return p === toks.length ? v !== 0 : true;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- values

/** The number a showIf expression sees for a control's raw bytes. */
export function controlNumber(c: MenuControl, raw: readonly number[]): number {
  if (c.type === 'toggle' && c.toggle)
    return c.toggle[1].every((b, i) => raw[i] === b) && c.toggle[1].length ? 1 : 0;
  return raw.slice(0, c.bytes).reduce((v, b) => (v << 8) | b, 0) >>> 0;
}

/** Bytes to send for a new number (big-endian, as VIA does). */
export function controlBytes(c: MenuControl, value: number): number[] {
  if (c.type === 'toggle' && c.toggle) return value ? c.toggle[1] : c.toggle[0];
  if (c.type === 'button' && c.toggle) return c.toggle[1];
  const out: number[] = [];
  for (let i = c.bytes - 1; i >= 0; i--) out.push((value >>> (8 * i)) & 0xff);
  return out;
}
