import type { ProtocolHint, SupportDevice } from '@openkey/core';

/**
 * What is publicly known about the protocol families a device may belong to, for diagnostic
 * packages and support requests. Hints describe; they never select an adapter or unlock a write.
 * Each matches on the report layout (`descriptor`) and, when the USB identity is a model the
 * family's sources name, on the identity too (`identity`).
 */
interface HintRule {
  id: string;
  title: string;
  /** Report layout the family uses: a vendor collection with these reports. */
  channel: {
    usagePage: number;
    usage?: number;
    output?: { reportId: number; size: number };
    input?: { reportId: number; size: number };
    feature?: { reportId: number; size: number };
  };
  vendorIds?: number[];
  /** Models the sources name, by USB identity. */
  models?: { vendorId: number; productId: number; name: string }[];
  facts: string[];
  sources: string[];
}

const RULES: readonly HintRule[] = [
  {
    id: 'winbond-oem',
    title: 'Winbond / Nuvoton OEM keyboard firmware (FL Esports, Pulsar, KT108 …)',
    channel: {
      usagePage: 0xff1b,
      usage: 0x91,
      output: { reportId: 1, size: 63 },
      input: { reportId: 1, size: 63 },
    },
    vendorIds: [0x0416],
    models: [
      { vendorId: 0x0416, productId: 0xc345, name: 'FL Esports MK870 (Nuvoton M252)' },
      { vendorId: 0x0416, productId: 0xb23c, name: 'Pulsar PCMK TKL / KT108 (Nuvoton NUC121)' },
    ],
    facts: [
      '64-byte frames on output report 1; byte 1 is the command, the keyboard answers on input report 1',
      'commands from the official driver: 01 handshake, 07 lighting (07 01 reads it), 08 side/logo light, 09 per-key colours, 18 key map, 14 profile reset',
      'LEDs and keys share one 6 × 22 matrix (132 positions); Fn is matrix index 121',
      'never sent by OpenKey: 0B enters the firmware updater, 16 writes the serial number, 22 LCD firmware',
    ],
    sources: [
      'FL Esports driver V1.06.16 (official; facts only)',
      'Mqlvin/keyboard-colour (MIT)',
      'gist DanielGibson/cd92c5faa6b2e0426351dc44193c6182 (facts only)',
    ],
  },
  {
    id: 'sonix-ajazz',
    title: 'AJAZZ / AULA Windows-driver protocol (Sonix)',
    channel: { usagePage: 0xff13, feature: { reportId: 0, size: 64 } },
    vendorIds: [0x0c45],
    facts: [
      '64-byte feature reports on FF13; bulk data on FF68 output reports of 4096 bytes',
      'session commands 04 18 start, 04 02 save, 04 F0 finish; the model is chosen by the USB product string',
    ],
    sources: [
      'Official AJAZZ AK820 MAX driver (facts only)',
      'OpenKey owner test on an AK820 MAX PLUS',
    ],
  },
  {
    id: 'by-tech',
    title: 'BY Tech OEM protocol (AULA F75/F87/F99, RK R75)',
    channel: { usagePage: 0xff00, feature: { reportId: 6, size: 519 } },
    vendorIds: [0x258a],
    facts: [
      'one 519-byte feature report: command, parameter, packages, index, length, 512-byte page',
      'the model is told by the six-byte code of command 82 01 (asked first)',
    ],
    sources: [
      'leisiji/AulaSofwareLinux (MIT)',
      'RK driver configuration via vinc3m1/kludgeknight (facts only)',
    ],
  },
  {
    id: 'evision',
    title: 'EVision keyboard firmware (Redragon, AJAZZ AK820 wired RGB …)',
    channel: { usagePage: 0xff1c, output: { reportId: 4, size: 63 } },
    vendorIds: [0x0c45, 0x320f],
    facts: [
      'output report 4 of 63 bytes with a 16-bit checksum; 0x06 parameters, 0x11 custom colours',
    ],
    sources: [
      'OpenRGB EVisionKeyboardController (facts only)',
      'Official AJAZZ AK820 wired RGB driver',
    ],
  },
  {
    id: 'semico',
    title: 'SEMICO keyboard firmware (AJAZZ AK992)',
    channel: { usagePage: 0xff01, feature: { reportId: 7, size: 7 } },
    facts: [
      'feature report 7 of 7 bytes: FF FF mode brightness speed 00 direction; no read command',
    ],
    sources: ['J0hnBloodborne/rea-jazz (MIT)'],
  },
];

const num = (h: string | null | undefined) => (h ? parseInt(h, 16) : NaN);

function hasChannel(device: SupportDevice, ch: HintRule['channel']): boolean {
  const has = (
    list: { reportId: number; size: number }[],
    want?: { reportId: number; size: number },
  ) => !want || list.some((r) => r.reportId === want.reportId && r.size === want.size);
  return device.interfaces.some((i) =>
    i.collections.some(
      (c) =>
        num(c.usagePage) === ch.usagePage &&
        (ch.usage === undefined || num(c.usage) === ch.usage) &&
        has(c.outputReports, ch.output) &&
        has(c.inputReports, ch.input) &&
        has(c.featureReports, ch.feature),
    ),
  );
}

/** Families whose report layout this device shows, most specific first. */
export function protocolHints(device: SupportDevice): ProtocolHint[] {
  const vid = num(device.vendorId);
  const pid = num(device.productId);
  const out: ProtocolHint[] = [];
  for (const r of RULES) {
    const layout = hasChannel(device, r.channel);
    const model = r.models?.find((m) => m.vendorId === vid && m.productId === pid);
    // Same vendor, but the channel is missing: say what to look for (e.g. a hidden interface).
    const vendorOnly = !layout && !!r.vendorIds?.includes(vid) && !!model;
    if (!layout && !vendorOnly) continue;
    out.push({
      id: r.id,
      title: model ? `${r.title}: ${model.name}` : r.title,
      basis: model ? 'identity' : 'descriptor',
      facts: vendorOnly
        ? [
            `the ${r.channel.usagePage.toString(16).toUpperCase()} vendor collection this family uses is not visible on this connection`,
            ...r.facts,
          ]
        : r.facts,
      sources: r.sources,
    });
  }
  return out.sort((a, b) => (a.basis === b.basis ? 0 : a.basis === 'identity' ? -1 : 1));
}
