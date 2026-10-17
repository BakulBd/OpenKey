/**
 * Connection doctor: why a keyboard does not connect or configure, and what fixes it.
 *
 * The checks are pure functions over facts the caller collects (browser, OS, the device's HID
 * collections, whether the OS let the device open, what the catalogue knows about its USB identity).
 * Nothing here talks to a device. The web app and the CLI share the checks and their English text;
 * the web app translates by check id and status where a translation exists.
 */

export type DoctorOs = 'linux' | 'windows' | 'macos' | 'chromeos' | 'android' | 'ios' | 'other';
export type DoctorStatus = 'pass' | 'info' | 'warn' | 'fail';
export type DoctorCheckId =
  | 'browser'
  | 'secure'
  | 'embedded'
  | 'access'
  | 'interface'
  | 'link'
  | 'shared-id'
  | 'known'
  | 'mac-accessory'
  | 'receiver-hidden';

export interface DoctorCollection {
  usagePage: number;
  usage: number;
  featureReports: number;
  outputReports: number;
}

/** One catalogue entry for the device's VID:PID. */
export interface DoctorKnownModel {
  model: string;
  link: 'usb' | '2.4ghz' | 'bluetooth';
  family: string;
}

export interface DoctorDevice {
  vendorId: number;
  productId: number;
  productName: string;
  /** HID collections per interface, as the platform reports them. */
  interfaces: DoctorCollection[][];
  /** The error the OS gave when the device was opened; null when it opened; undefined when not tried. */
  openError?: string | null;
  /** Catalogue entries for this VID:PID (empty when the identity is not catalogued). */
  known: DoctorKnownModel[];
  /** Names VIA's public catalogue lists for this VID:PID, when the caller looked them up. */
  viaNames?: string[];
}

export interface DoctorInput {
  runtime: 'browser' | 'cli';
  os: DoctorOs;
  /** Browser only: WebHID present, secure context, running inside a frame. */
  webHid?: boolean;
  secureContext?: boolean;
  embedded?: boolean;
  device?: DoctorDevice;
}

export interface DoctorCheck {
  id: DoctorCheckId;
  status: DoctorStatus;
  title: string;
  detail: string;
  /** The next step, when there is one. */
  fix?: string;
  /** Values the text refers to, for translations. */
  params: Record<string, string>;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** Standard pages the OS and the browser keep for typing (keyboard, consumer keys, system control). */
const PROTECTED = (c: DoctorCollection) =>
  (c.usagePage === 0x01 && (c.usage === 0x06 || c.usage === 0x02 || c.usage === 0x80)) ||
  c.usagePage === 0x0c;

const VIA_PAGE = 0xff60;
/** HID LampArray: the public lighting standard (Windows Dynamic Lighting). */
const LAMPARRAY = (c: DoctorCollection) => c.usagePage === 0x59 && c.usage === 0x01;

/** The vendor app that usually holds a keyboard of this family open, by catalogue family. */
const VENDOR_APP: Record<string, string> = {
  'razer-chroma': 'Razer Synapse',
  'logitech-hidpp': 'Logitech G HUB',
  'steelseries-apex': 'SteelSeries GG',
  'wooting-rgb': 'Wootility',
  'hyperx-alloy-origins': 'HyperX NGENUITY',
  'ducky-rgb': 'DuckyHub',
  'bloody-b820r': 'the Bloody software',
  evision: 'the keyboard’s own driver app',
};
/** Families whose control channel sits on a standard (mouse or consumer) collection. */
const STANDARD_CHANNEL = new Set(['razer-chroma']);

function check(
  id: DoctorCheckId,
  status: DoctorStatus,
  title: string,
  detail: string,
  fix?: string,
  params: Record<string, string> = {},
): DoctorCheck {
  return { id, status, title, detail, ...(fix ? { fix } : {}), params };
}

function browserChecks(input: DoctorInput): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const mobile = input.os === 'android' || input.os === 'ios';
  if (mobile)
    out.push(
      check(
        'browser',
        'fail',
        'Phones and tablets cannot configure keyboards',
        'Mobile browsers do not implement WebHID.',
        'Open OpenKey on a Windows, macOS, Linux or ChromeOS computer in Chrome or Edge.',
      ),
    );
  else if (!input.webHid)
    out.push(
      check(
        'browser',
        'fail',
        'This browser has no WebHID',
        'Firefox and Safari do not implement WebHID, so the page cannot reach the keyboard.',
        'Use Chrome, Edge, Opera, Brave or another Chromium browser, or the openkey command-line tool.',
      ),
    );
  else
    out.push(
      check('browser', 'pass', 'WebHID is available', 'This browser can talk to HID devices.'),
    );

  if (input.secureContext === false)
    out.push(
      check(
        'secure',
        'fail',
        'Not a secure page',
        'WebHID only works on HTTPS or http://localhost.',
        'Open the HTTPS address of OpenKey.',
      ),
    );
  if (input.embedded)
    out.push(
      check(
        'embedded',
        'warn',
        'Running inside another page',
        'Embedded pages usually may not use WebHID.',
        'Open OpenKey in its own tab.',
      ),
    );
  if (input.os === 'macos')
    out.push(
      check(
        'mac-accessory',
        'info',
        'macOS may ask to allow the accessory',
        'On Apple silicon Macs, a newly plugged USB device must be allowed before it works.',
        'If macOS shows "Allow accessory to connect?", choose Allow, then reconnect.',
      ),
    );
  return out;
}

function accessCheck(os: DoctorOs, d: DoctorDevice, runtime: DoctorInput['runtime']): DoctorCheck {
  const id = `${hex4(d.vendorId)}:${hex4(d.productId)}`;
  if (d.openError === undefined)
    return check(
      'access',
      'info',
      'Access not tested',
      'The device was not opened yet.',
      undefined,
      {
        id,
      },
    );
  if (d.openError === null)
    return check('access', 'pass', 'The system lets OpenKey open the keyboard', '', undefined, {
      id,
    });
  if (os === 'linux')
    return check(
      'access',
      'fail',
      'Linux blocks access to the keyboard',
      `The hidraw device is readable by root only (${d.openError}).`,
      runtime === 'cli'
        ? `Install the udev rule: sudo sh udev/install-openkey-udev.sh --device ${id}, then unplug and replug the keyboard.`
        : `Install the OpenKey udev rule (one command, shown on the Connect page) with --device ${id}, then unplug and replug the keyboard.`,
      { id, error: d.openError },
    );
  const app = d.known.map((k) => VENDOR_APP[k.family]).find(Boolean) ?? 'the vendor driver app';
  return check(
    'access',
    'fail',
    'Another program holds the keyboard',
    `The system refused to open it (${d.openError}).`,
    `Quit ${app} (look for its tray or menu-bar icon), then unplug and replug the keyboard.`,
    { id, error: d.openError, app },
  );
}

/** FF60 is VIA's page, but vendor firmware reuses it; it means VIA only for uncatalogued or VIA identities. */
const viaLikely = (d: DoctorDevice) =>
  d.interfaces.flat().some((c) => c.usagePage === VIA_PAGE) &&
  (d.known.length === 0 || d.known.some((k) => k.family === 'qmk-via'));

function interfaceCheck(d: DoctorDevice): DoctorCheck {
  const all = d.interfaces.flat();
  if (viaLikely(d))
    return check(
      'interface',
      'pass',
      'The VIA/Vial configuration interface is present',
      'Page FF60 is the raw HID channel QMK/VIA and Vial firmware configure through.',
    );
  if (all.some(LAMPARRAY))
    return check(
      'interface',
      'pass',
      'The standard lighting interface (HID LampArray) is present',
      'Page 0x59 is the public lighting standard Windows Dynamic Lighting uses. On Windows, turn off “Use Dynamic Lighting on my devices” while OpenKey sets colours.',
    );
  if (
    d.known.some((k) => STANDARD_CHANNEL.has(k.family)) &&
    all.some(
      (c) =>
        c.featureReports > 0 && c.usagePage < 0xff00 && !(c.usagePage === 0x01 && c.usage === 0x06),
    )
  )
    return check(
      'interface',
      'pass',
      'The configuration interface is present',
      'This brand configures through a feature report on its mouse or media-key interface.',
    );
  const vendor = all.filter((c) => c.usagePage >= 0xff00);
  if (vendor.length)
    return check(
      'interface',
      'pass',
      'A vendor configuration interface is present',
      `Vendor page ${vendor.map((c) => hex4(c.usagePage)).join(', ')} is the channel configuration tools use.`,
    );
  if (all.length && all.every(PROTECTED))
    return check(
      'interface',
      'fail',
      'Only the typing interface is available',
      'The granted entry is the standard keyboard, which browsers keep for typing. Configuration needs the vendor interface.',
      'Connect again and pick the other entry for this keyboard in the browser list. If there is none, use the USB cable and switch the keyboard to wired mode.',
    );
  return check(
    'interface',
    'warn',
    'No vendor configuration interface',
    'This device declares no vendor-defined HID page, so it may have nothing to configure on this connection.',
    'Try the USB cable in wired mode. Typing and the tester work either way.',
  );
}

function linkCheck(d: DoctorDevice): DoctorCheck | null {
  const wireless = d.known.filter((k) => k.link !== 'usb');
  if (!wireless.length) return null;
  const k = wireless[0]!;
  const readOnly = k.family === 'none';
  return check(
    'link',
    readOnly ? 'fail' : 'warn',
    k.link === 'bluetooth' ? 'Connected over Bluetooth' : 'Connected through the 2.4 GHz receiver',
    readOnly
      ? 'Configuration is not available on this link.'
      : 'Wireless links carry only part of the configuration, or none of it, on most boards.',
    'Plug in the USB cable and set the keyboard switch to wired (USB) mode for full configuration.',
    { model: k.model, link: k.link },
  );
}

/**
 * macOS: 2.4 GHz receivers of the AJAZZ/AULA platform have vendor endpoints (FF59 command, FF60 raw)
 * that the vendors' own tools reach, but the browser can be shown only the typing, media and system
 * collections; VitalyArt/Aula-F75-Max-Driver ties this to the Input Monitoring permission.
 */
function receiverHiddenCheck(os: DoctorOs, d: DoctorDevice): DoctorCheck | null {
  if (os !== 'macos' || !d.known.some((k) => k.link === '2.4ghz')) return null;
  const all = d.interfaces.flat();
  if (!all.length || all.some((c) => c.usagePage >= 0xff00)) return null;
  return check(
    'receiver-hidden',
    'warn',
    'macOS may be hiding the receiver’s configuration channel',
    'Receivers of this kind normally have vendor endpoints, but the browser sees only typing, media and system collections.',
    'Allow your browser in System Settings → Privacy & Security → Input Monitoring, quit and reopen it, replug the receiver and connect again. Or plug in the USB cable and switch the keyboard to wired mode.',
  );
}

function knownChecks(d: DoctorDevice): DoctorCheck[] {
  const id = `${hex4(d.vendorId)}:${hex4(d.productId)}`;
  const models = [...new Set(d.known.map((k) => k.model))];
  const families = [...new Set(d.known.map((k) => k.family))];
  if (!models.length && d.viaNames?.length) {
    const names = [...new Set(d.viaNames)].join(' / ');
    return [
      check(
        'known',
        'pass',
        `Listed in VIA’s catalogue: ${names}`,
        `${id} has a public VIA definition; OpenKey configures it as a VIA board and downloads the layout when you ask.`,
        undefined,
        { id, models: names },
      ),
    ];
  }
  if (!models.length) {
    const via = viaLikely(d);
    return [
      check(
        'known',
        via ? 'pass' : 'info',
        via ? 'Open firmware detected' : 'This USB identity is not in the catalogue',
        via
          ? `${id} exposes the VIA raw HID page; OpenKey configures it as a VIA/Vial board.`
          : `${id} is not a catalogued model. OpenKey still identifies it from its descriptors and answers.`,
        via
          ? undefined
          : 'If it stays unsupported, export the diagnostics and open a device-support request.',
        { id },
      ),
    ];
  }
  const out = [
    check('known', 'pass', `Catalogued: ${models.join(' / ')}`, '', undefined, {
      id,
      models: models.join(' / '),
    }),
  ];
  if (models.length > 1 || families.length > 1)
    out.push(
      check(
        'shared-id',
        'info',
        'Several models share this USB identity',
        `${id} is used by ${models.length} catalogued models${families.length > 1 ? ` on ${families.length} protocol families` : ''}. OpenKey decides from the keyboard's own answers, never from the ID alone.`,
        'If OpenKey shows the wrong model, export the diagnostics and report it.',
        { id, n: String(models.length) },
      ),
    );
  return out;
}

/** Runs every check that applies. Device checks are skipped when no device is given. */
export function runDoctor(input: DoctorInput): DoctorCheck[] {
  const out = input.runtime === 'browser' ? browserChecks(input) : [];
  const d = input.device;
  if (!d) return out;
  out.push(accessCheck(input.os, d, input.runtime));
  const link = linkCheck(d);
  if (link) out.push(link);
  out.push(interfaceCheck(d));
  const hidden = receiverHiddenCheck(input.os, d);
  if (hidden) out.push(hidden);
  out.push(...knownChecks(d));
  return out;
}

/** The worst status in a list of checks. */
export function doctorSummary(checks: DoctorCheck[]): DoctorStatus {
  const order: DoctorStatus[] = ['fail', 'warn', 'info', 'pass'];
  return order.find((s) => checks.some((c) => c.status === s)) ?? 'pass';
}
