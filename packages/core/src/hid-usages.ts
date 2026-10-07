/**
 * Human-readable names for HID usages (HID Usage Tables 1.4). Only the pages a keyboard
 * configurator needs: Keyboard (0x07), Consumer (0x0C) and Generic Desktop system controls (0x01).
 */

const KEYBOARD: Record<number, string> = {
  0x00: 'None',
  0x28: 'Enter',
  0x29: 'Esc',
  0x2a: 'Backspace',
  0x2b: 'Tab',
  0x2c: 'Space',
  0x2d: '-',
  0x2e: '=',
  0x2f: '[',
  0x30: ']',
  0x31: '\\',
  0x32: 'Non-US #',
  0x33: ';',
  0x34: "'",
  0x35: '`',
  0x36: ',',
  0x37: '.',
  0x38: '/',
  0x39: 'Caps Lock',
  0x46: 'Print Screen',
  0x47: 'Scroll Lock',
  0x48: 'Pause',
  0x49: 'Insert',
  0x4a: 'Home',
  0x4b: 'Page Up',
  0x4c: 'Delete',
  0x4d: 'End',
  0x4e: 'Page Down',
  0x4f: 'Right',
  0x50: 'Left',
  0x51: 'Down',
  0x52: 'Up',
  0x53: 'Num Lock',
  0x54: 'KP /',
  0x55: 'KP *',
  0x56: 'KP -',
  0x57: 'KP +',
  0x58: 'KP Enter',
  0x63: 'KP .',
  0x64: 'Non-US \\',
  0x65: 'Menu',
  0xe0: 'Left Ctrl',
  0xe1: 'Left Shift',
  0xe2: 'Left Alt',
  0xe3: 'Left GUI',
  0xe4: 'Right Ctrl',
  0xe5: 'Right Shift',
  0xe6: 'Right Alt',
  0xe7: 'Right GUI',
};
for (let i = 0; i < 26; i++) KEYBOARD[0x04 + i] = String.fromCharCode(65 + i);
for (let i = 1; i <= 9; i++) KEYBOARD[0x1d + i] = String(i);
KEYBOARD[0x27] = '0';
for (let i = 0; i < 12; i++) KEYBOARD[0x3a + i] = `F${i + 1}`;
for (let i = 0; i < 12; i++) KEYBOARD[0x68 + i] = `F${i + 13}`;
for (let i = 1; i <= 9; i++) KEYBOARD[0x58 + i] = `KP ${i}`;
KEYBOARD[0x62] = 'KP 0';

const CONSUMER: Record<number, string> = {
  0x6f: 'Brightness Up',
  0x70: 'Brightness Down',
  0xb5: 'Next Track',
  0xb6: 'Previous Track',
  0xb7: 'Stop',
  0xcd: 'Play/Pause',
  0xe2: 'Mute',
  0xe9: 'Volume Up',
  0xea: 'Volume Down',
  0x183: 'Media Player',
  0x18a: 'Mail',
  0x192: 'Calculator',
  0x194: 'My Computer',
  0x221: 'Search',
  0x223: 'Browser Home',
  0x224: 'Browser Back',
  0x225: 'Browser Forward',
  0x227: 'Browser Refresh',
  0x22a: 'Bookmarks',
};

const SYSTEM: Record<number, string> = {
  0x81: 'System Power Down',
  0x82: 'System Sleep',
  0x83: 'System Wake Up',
};

export function usageName(page: number, usage: number): string {
  const table =
    page === 0x07 ? KEYBOARD : page === 0x0c ? CONSUMER : page === 0x01 ? SYSTEM : undefined;
  return table?.[usage] ?? `0x${page.toString(16)}:${usage.toString(16).padStart(2, '0')}`;
}

export function keyboardUsages(): { usage: number; name: string }[] {
  return Object.entries(KEYBOARD)
    .map(([k, name]) => ({ usage: Number(k), name }))
    .filter((u) => u.usage !== 0)
    .sort((a, b) => a.usage - b.usage);
}

export function consumerUsages(): { usage: number; name: string }[] {
  return Object.entries(CONSUMER).map(([k, name]) => ({ usage: Number(k), name }));
}

/** Maps a DOM KeyboardEvent.code to a HID Keyboard usage (for macro recording). */
export function domCodeToUsage(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return 0x04 + code.charCodeAt(3) - 65;
  if (/^Digit[1-9]$/.test(code)) return 0x1e + Number(code[5]) - 1;
  if (code === 'Digit0') return 0x27;
  const f = /^F(\d{1,2})$/.exec(code);
  if (f) {
    const n = Number(f[1]);
    if (n >= 1 && n <= 12) return 0x3a + n - 1;
    if (n >= 13 && n <= 24) return 0x68 + n - 13;
  }
  const table: Record<string, number> = {
    Enter: 0x28,
    Escape: 0x29,
    Backspace: 0x2a,
    Tab: 0x2b,
    Space: 0x2c,
    Minus: 0x2d,
    Equal: 0x2e,
    BracketLeft: 0x2f,
    BracketRight: 0x30,
    Backslash: 0x31,
    Semicolon: 0x33,
    Quote: 0x34,
    Backquote: 0x35,
    Comma: 0x36,
    Period: 0x37,
    Slash: 0x38,
    CapsLock: 0x39,
    PrintScreen: 0x46,
    ScrollLock: 0x47,
    Pause: 0x48,
    Insert: 0x49,
    Home: 0x4a,
    PageUp: 0x4b,
    Delete: 0x4c,
    End: 0x4d,
    PageDown: 0x4e,
    ArrowRight: 0x4f,
    ArrowLeft: 0x50,
    ArrowDown: 0x51,
    ArrowUp: 0x52,
    IntlBackslash: 0x64,
    ContextMenu: 0x65,
    ControlLeft: 0xe0,
    ShiftLeft: 0xe1,
    AltLeft: 0xe2,
    MetaLeft: 0xe3,
    ControlRight: 0xe4,
    ShiftRight: 0xe5,
    AltRight: 0xe6,
    MetaRight: 0xe7,
  };
  return table[code];
}
