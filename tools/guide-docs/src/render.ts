/**
 * Renders docs/MODEL_GUIDE.md and docs/RESEARCH_INVENTORY.md from packages/devices (the data the
 * app's Compatibility page shows), so the documents never drift from the app.
 */
import { MODEL_GUIDE } from '@openkey/devices/guide';
import type { GuideEntry, GuideLevel, ModelRevision } from '@openkey/devices/guide';
import { VIA_BOARDS, VIA_INDEX_DATE, VIA_INDEX_SOURCE } from '@openkey/devices/via-index';

const LEVEL: Record<GuideLevel, string> = {
  verified: '✅ Verified',
  adapter: '🟢 Configurable',
  via: '🟢 Via VIA',
  depends: '🟡 Depends on version',
  'vendor-only': '⚪ Vendor software only',
  'nothing-to-configure': '⚪ Nothing to configure',
};

const GROUPS: [GuideEntry['group'], string][] = [
  ['bangladesh', 'Popular in Bangladesh'],
  ['asia', 'Asia and custom boards'],
  ['via', 'QMK / VIA keyboards (from VIA’s catalogue)'],
  ['gaming', 'Global gaming'],
  ['enthusiast', 'Typing and enthusiast'],
];

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');

const thousands = (n: number) => n.toLocaleString('en-US');

export function modelGuideMarkdown(): string {
  const out = [
    '# Is my keyboard supported?',
    '',
    "Generated from `packages/devices/src/guide.ts` (the same data the app's Compatibility page shows). A model name often covers several hardware revisions, so OpenKey always decides from the keyboard it detects. Every keyboard works in the tester and the latency lab, and any keyboard can be inspected read-only and reported.",
    '',
    '"Vendor software only" means the keyboard uses a closed, model-specific protocol with no public documentation. OpenKey never sends guessed commands, so it does not configure them.',
    '',
    `VIA keyboards: ${thousands(VIA_BOARDS.length)} are listed in [VIA's catalogue](https://caniusevia.com/docs/supported_keyboards/) (index of ${VIA_INDEX_DATE}). OpenKey configures any of them through its VIA adapter and can download the layout from usevia.app with one click.`,
    '',
    'When a model ships on several chips, the [research inventory](RESEARCH_INVENTORY.md) lists each revision and the community sources.',
  ];
  for (const [g, title] of GROUPS) {
    const list = MODEL_GUIDE.filter((e) => e.group === g);
    if (!list.length) continue;
    out.push(
      '',
      `## ${title}`,
      '',
      table(
        ['Keyboard', 'Support', 'Details'],
        list.map((e) => [`${e.brand} ${e.model}`, LEVEL[e.level], e.note]),
      ),
    );
  }
  return `${out.join('\n')}\n`;
}

const REV: Record<ModelRevision['status'], string> = {
  verified: 'verified',
  community: 'configurable',
  'read-only': 'read-only',
  research: 'research',
  none: 'nothing to configure',
};

/** What it takes to move the model up one level. */
function needed(e: GuideEntry): string {
  switch (e.level) {
    case 'verified':
      return 'Done for the verified revision; other revisions need an owner test.';
    case 'adapter':
      return 'An owner test on hardware (a `-hw.json` fixture) to promote writes to verified.';
    case 'via':
      return 'Nothing for VIA boards; a layout file when it is not in VIA’s catalogue.';
    case 'depends':
      return e.sources?.length
        ? 'Protocol facts from the sources, checked against a diagnostic from an owner.'
        : 'A diagnostic from an owner (Connection doctor → export) to identify the chip.';
    case 'vendor-only':
      return 'A public, licence-compatible protocol description.';
    case 'nothing-to-configure':
      return '—';
  }
}

/** Models from the owner's list that the searches returned nothing for (October 2026). */
const SEARCHED_EMPTY = [
  'AJAZZ AK873',
  'AJAZZ AK966',
  'AULA S75',
  'Akko 5075S',
  'Royal Kludge S98',
  'Royal Kludge RK68, RK71, RK89, RK96, RK100, RK104 (all in the classic RK model list, so configurable without a separate source)',
];

export function researchInventoryMarkdown(): string {
  const brands = [...new Set(MODEL_GUIDE.map((e) => e.brand))];
  const out = [
    '# Research inventory',
    '',
    'Generated from `packages/devices/src/guide.ts`. One row per model: every known hardware revision (one model name often ships on several chips) and the open-source projects found for it. The projects are used for facts only (USB identities, report IDs, command bytes, framing); no code is copied, and a source without a licence is never used for more than facts.',
    '',
    'Method: GitHub repository searches for each model of the owner-supplied list (October 2026), plus the sources already cited by the adapters. A source documents a protocol; it does not make the model supported. A model becomes configurable only when an adapter implements the protocol with read-back, and verified only after an owner test on hardware.',
    '',
    `VIA boards are not listed one by one: ${thousands(VIA_BOARDS.length)} are indexed from ${VIA_INDEX_SOURCE} (${VIA_INDEX_DATE}).`,
  ];
  for (const brand of brands) {
    const list = MODEL_GUIDE.filter(
      (e) => e.brand === brand && (e.revisions?.length || e.sources?.length || e.group !== 'via'),
    );
    if (!list.length) continue;
    out.push(
      '',
      `## ${brand}`,
      '',
      table(
        ['Model', 'OpenKey', 'Revisions (chip: status)', 'Sources (licence)', 'To verify'],
        list.map((e) => [
          e.model,
          LEVEL[e.level],
          e.revisions?.length
            ? e.revisions
                .map(
                  (r) =>
                    `${r.name}${r.ids.length ? ` (${r.ids.join(', ')})` : ''} — ${r.chip}: ${REV[r.status]}`,
                )
                .join('; ')
            : '—',
          e.sources?.length
            ? e.sources
                .map(
                  (s) =>
                    `[${s.repo}](https://github.com/${s.repo}) (${s.license ?? 'no licence'}): ${s.covers}`,
                )
                .join('; ')
            : '—',
          needed(e),
        ]),
      ),
    );
  }
  out.push(
    '',
    '## Searched, nothing found',
    '',
    ...SEARCHED_EMPTY.map((m) => `- ${m}`),
    '',
    '## Out of scope',
    '',
    '- AULA SC580 is a mouse, not a keyboard.',
  );
  return `${out.join('\n')}\n`;
}
