import { useEffect, useState } from 'react';
import { describeAction, usageName } from '@openkey/core';
import type { KeyAction, KeyActionKind, Transaction } from '@openkey/core';
import type { via } from '@openkey/protocols';
import { useKeyboard } from '../../state/keyboard.js';
import { useT } from '../../i18n/i18n.js';
import { Card, Field, Loading, PageHeader, SourceNote, Toggle } from '../../components/ui.js';
import { ChangeBar, useChangeTracking } from '../../components/ChangeBar.js';
import { KeyPicker } from '../keymap/KeyPicker.js';
import { WriteGateNote } from '../shared/WriteGateNote.js';

type TapDance = via.TapDance;
type Combo = via.Combo;
type KeyOverride = via.KeyOverride;
type Field_ = via.QmkSettingField;

interface VialHost {
  vialFeatures: { settings: number[]; counts: via.VialCounts } | null;
  qmkSettingFields(): Field_[];
  readQmkSettings(): Promise<Record<number, number>>;
  writeQmkSettings(v: Record<number, number>): Promise<void>;
  readTapDances(): Promise<TapDance[]>;
  readCombos(): Promise<Combo[]>;
  readKeyOverrides(): Promise<KeyOverride[]>;
  writeVialEntry(
    kind: 'tapDance' | 'combo' | 'keyOverride',
    index: number,
    entry: TapDance | Combo | KeyOverride,
  ): Promise<void>;
  decodeKey(code: number): KeyAction;
  encodeKey(a: KeyAction): number;
  getKeyActionKinds(): readonly KeyActionKind[];
  getSpecialActions(): readonly { code: number; label: string }[];
  getLayerIds(): readonly string[];
}

type Tab = 'settings' | 'tapDance' | 'combo' | 'keyOverride';
const MODS = ['LCtrl', 'LShift', 'LAlt', 'LGUI', 'RCtrl', 'RShift', 'RAlt', 'RGUI'];

/**
 * Vial extras: QMK settings, tap dance, combos and key overrides, read from the keyboard and written
 * back one entry at a time with a read-back check.
 */
export default function VialStudio() {
  const t = useT();
  const { device } = useKeyboard();
  const host = device?.driver as unknown as VialHost | undefined;
  const counts = host?.vialFeatures?.counts;
  const tabs: Tab[] = [
    ...(host?.qmkSettingFields?.().length ? (['settings'] as const) : []),
    ...(counts?.tapDance ? (['tapDance'] as const) : []),
    ...(counts?.combos ? (['combo'] as const) : []),
    ...(counts?.keyOverrides ? (['keyOverride'] as const) : []),
  ];
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab && tabs.includes(tab) ? tab : (tabs[0] ?? null);
  if (!device || !host) return null;
  return (
    <div className="page">
      <PageHeader title={t('nav.vial')} lead={t('vial.lead')} />
      <div className="tabs" role="tablist" aria-label={t('nav.vial')}>
        {tabs.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={active === x}
            className={`tab ${active === x ? 'on' : ''}`}
            onClick={() => setTab(x)}
          >
            {t(`vial.tab.${x}`)}
          </button>
        ))}
      </div>
      {active === 'settings' && <QmkSettings host={host} />}
      {active && active !== 'settings' && <Entries key={active} host={host} kind={active} />}
      {!active && <p className="muted">{t('vial.none')}</p>}
    </div>
  );
}

function QmkSettings({ host }: { host: VialHost }) {
  const t = useT();
  const { read, apply, gate } = useKeyboard();
  const [applied, setApplied] = useState<Record<number, number> | null>(null);
  const [values, setValues] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    void read(t('vial.read'), () => host.readQmkSettings()).then((v) => {
      if (!v) return;
      setApplied(v);
      setValues(v);
    });
  }, [host, read, t]);
  const changed =
    values && applied ? Object.keys(values).filter((k) => values[+k] !== applied[+k]) : [];
  const track = useChangeTracking('vial-settings', ['firmwareSettings'], changed.length);
  if (!values || !applied) return <Loading />;
  const fields = host.qmkSettingFields();

  const write = async () => {
    const tx: Transaction<Record<number, number>> = {
      label: t('vial.applySettings'),
      acknowledged: true,
      apply: (v) => host.writeQmkSettings(Object.fromEntries(changed.map((k) => [k, v[+k]!]))),
      readbackFromDevice: () => host.readQmkSettings(),
    };
    const r = await apply('firmwareSettings', tx, applied, values);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(values);
  };

  return (
    <>
      <div className="row wrap between">
        <SourceNote source="device" />
        <WriteGateNote gate={gate('firmwareSettings')} />
      </div>
      <Card title={t('vial.tab.settings')}>
        <div className="form-grid">
          {fields.map((f) => {
            const v = values[f.id] ?? 0;
            const key = `${f.id}-${f.bit ?? 'v'}`;
            if (f.bit !== undefined)
              return (
                <Toggle
                  key={key}
                  label={f.label}
                  checked={((v >>> f.bit) & 1) === 1}
                  onChange={(on) =>
                    setValues({
                      ...values,
                      [f.id]: on ? (v | (1 << f.bit!)) >>> 0 : (v & ~(1 << f.bit!)) >>> 0,
                    })
                  }
                />
              );
            return (
              <Field key={key} label={`${f.label}${f.unit ? ` (${f.unit.trim()})` : ''}`}>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={v}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n))
                      setValues({
                        ...values,
                        [f.id]: Math.min(f.max ?? n, Math.max(f.min ?? n, n)),
                      });
                  }}
                />
              </Field>
            );
          })}
        </div>
      </Card>
      <ChangeBar
        status={track.status}
        count={changed.length}
        verifies
        canApply={gate('firmwareSettings').decision.kind !== 'blocked'}
        busy={track.busy}
        onDiscard={() => {
          setValues(applied);
          track.discarded();
        }}
        onApply={() => void write()}
        applyLabel={t('common.apply')}
      />
    </>
  );
}

type Entry = TapDance | Combo | KeyOverride;

/** Keycode fields of an entry, as [label key, getter, setter]. */
function keyFields(
  kind: Exclude<Tab, 'settings'>,
): [string, (e: Entry) => number, (e: Entry, v: number) => Entry][] {
  if (kind === 'tapDance')
    return (['onTap', 'onHold', 'onDoubleTap', 'onTapHold'] as const).map((k) => [
      `vial.td.${k}`,
      (e) => (e as TapDance)[k],
      (e, v) => ({ ...(e as TapDance), [k]: v }),
    ]);
  if (kind === 'combo')
    return [
      ...[0, 1, 2, 3].map((i): [string, (e: Entry) => number, (e: Entry, v: number) => Entry] => [
        `vial.combo.key${i + 1}`,
        (e) => (e as Combo).input[i]!,
        (e, v) => {
          const c = e as Combo;
          const input = [...c.input] as Combo['input'];
          input[i] = v;
          return { ...c, input };
        },
      ]),
      ['vial.combo.output', (e) => (e as Combo).output, (e, v) => ({ ...(e as Combo), output: v })],
    ];
  return [
    [
      'vial.ko.trigger',
      (e) => (e as KeyOverride).trigger,
      (e, v) => ({ ...(e as KeyOverride), trigger: v }),
    ],
    [
      'vial.ko.replacement',
      (e) => (e as KeyOverride).replacement,
      (e, v) => ({ ...(e as KeyOverride), replacement: v }),
    ],
  ];
}

function Entries({ host, kind }: { host: VialHost; kind: Exclude<Tab, 'settings'> }) {
  const t = useT();
  const { read, apply, gate } = useKeyboard();
  const [applied, setApplied] = useState<Entry[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [field, setField] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const load = (): Promise<Entry[]> =>
      kind === 'tapDance'
        ? host.readTapDances()
        : kind === 'combo'
          ? host.readCombos()
          : host.readKeyOverrides();
    void read(t('vial.read'), load).then((v) => {
      if (!v) return;
      setApplied(v);
      setEntries(v);
    });
  }, [host, kind, read, t]);
  const same = (a?: Entry, b?: Entry) => JSON.stringify(a) === JSON.stringify(b);
  const dirty = entries && applied ? entries.filter((e, i) => !same(e, applied[i])).length : 0;
  const track = useChangeTracking(`vial-${kind}`, ['advancedKeys'], dirty);
  if (!entries || !applied) return <Loading />;
  const entry = entries[index]!;
  const fields = keyFields(kind);
  const [, get, set] = fields[field] ?? fields[0]!;
  const describe = (code: number) => describeAction(host.decodeKey(code), usageName);
  const update = (e: Entry) => setEntries(entries.map((x, i) => (i === index ? e : x)));

  const write = async () => {
    const changedIdx = entries.map((e, i) => (same(e, applied[i]) ? -1 : i)).filter((i) => i >= 0);
    const tx: Transaction<Entry[]> = {
      label: t(`vial.tab.${kind}`),
      acknowledged: true,
      apply: async (v) => {
        for (const i of changedIdx) await host.writeVialEntry(kind, i, v[i]!);
      },
    };
    const r = await apply('advancedKeys', tx, applied, entries);
    track.record(r);
    if (r && (r.outcome === 'VERIFIED' || r.outcome === 'SENT_UNVERIFIED')) setApplied(entries);
  };

  return (
    <>
      <div className="row wrap between">
        <SourceNote source="device" />
        <WriteGateNote gate={gate('advancedKeys')} />
      </div>
      <div className="grid2">
        <Card title={t('vial.entries')}>
          <div className="chips wrap" role="group" aria-label={t('vial.entries')}>
            {entries.map((e, i) => (
              <button
                key={i}
                type="button"
                className={`chip ${i === index ? 'on' : ''} ${same(e, applied[i]) ? '' : 'dirty'}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                {kind === 'tapDance' ? `TD ${i}` : `#${i + 1}`}
              </button>
            ))}
          </div>
          <div className="vial-fields">
            {fields.map(([label, g], i) => (
              <button
                key={label}
                type="button"
                className={`btn small ${i === field ? 'primary' : ''}`}
                onClick={() => setField(i)}
              >
                {t(label as Parameters<typeof t>[0])}: {describe(g(entry))}
              </button>
            ))}
          </div>
          {kind === 'tapDance' && (
            <Field label={t('vial.td.term')}>
              <input
                type="number"
                min={0}
                max={10000}
                value={(entry as TapDance).tappingTerm}
                onChange={(e) =>
                  update({
                    ...(entry as TapDance),
                    tappingTerm: Math.max(0, Number(e.target.value) | 0),
                  })
                }
              />
            </Field>
          )}
          {kind === 'keyOverride' && (
            <OverrideOptions entry={entry as KeyOverride} onChange={update} />
          )}
        </Card>
        <Card title={t('vial.pick')}>
          <KeyPicker
            value={host.decodeKey(get(entry))}
            onChange={(a) => update(set(entry, host.encodeKey(a)))}
            kinds={host.getKeyActionKinds()}
            macroSlots={0}
            query={query}
            onQuery={setQuery}
            specials={host.getSpecialActions()}
            layerCount={host.getLayerIds().length}
          />
        </Card>
      </div>
      <ChangeBar
        status={track.status}
        count={dirty}
        verifies
        canApply={gate('advancedKeys').decision.kind !== 'blocked'}
        busy={track.busy}
        onDiscard={() => {
          setEntries(applied);
          track.discarded();
        }}
        onApply={() => void write()}
        applyLabel={t('common.apply')}
      />
    </>
  );
}

function OverrideOptions({
  entry,
  onChange,
}: {
  entry: KeyOverride;
  onChange: (e: KeyOverride) => void;
}) {
  const t = useT();
  const mods = (field: 'triggerMods' | 'suppressedMods' | 'negativeModMask') => (
    <fieldset className="mod-set">
      <legend className="small">{t(`vial.ko.${field}`)}</legend>
      {MODS.map((m, bit) => (
        <label key={m} className="small">
          <input
            type="checkbox"
            checked={((entry[field] >> bit) & 1) === 1}
            onChange={(e) =>
              onChange({
                ...entry,
                [field]: e.target.checked ? entry[field] | (1 << bit) : entry[field] & ~(1 << bit),
              })
            }
          />{' '}
          {m}
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className="stack">
      <Toggle
        label={t('vial.ko.enabled')}
        checked={(entry.options & 0x80) !== 0}
        onChange={(on) =>
          onChange({ ...entry, options: on ? entry.options | 0x80 : entry.options & 0x7f })
        }
      />
      {mods('triggerMods')}
      {mods('suppressedMods')}
      {mods('negativeModMask')}
      <Field label={t('vial.ko.layers')} hint={t('vial.ko.layersHint')}>
        <input
          className="mono"
          value={`0x${entry.layers.toString(16).padStart(4, '0')}`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isInteger(v) && v >= 0 && v <= 0xffff) onChange({ ...entry, layers: v });
          }}
        />
      </Field>
    </div>
  );
}
