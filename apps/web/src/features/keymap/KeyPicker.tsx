import { useMemo, useState } from 'react';
import { MODIFIER_BITS, actionsEqual, keycodeCatalog, searchKeycodes } from '@openkey/core';
import type {
  KeyAction,
  KeyActionKind,
  KeycodeEntry,
  KeycodeGroup,
  MacroPlayMode,
} from '@openkey/core';
import { useT } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';

const GROUPS: KeycodeGroup[] = [
  'letters',
  'digits',
  'function',
  'navigation',
  'editing',
  'modifiers',
  'punctuation',
  'numpad',
  'media',
  'system',
  'mouse',
  'shortcuts',
  'layers',
  'special',
];

/**
 * Searchable action picker. Only action kinds the active adapter can encode are offered, so a choice
 * here can never fail at write time for being unsupported. Keycode names are HID legends; group names
 * and controls are translated.
 */
export function KeyPicker({
  value,
  onChange,
  kinds,
  macroSlots,
  query,
  onQuery,
  specials = [],
  layerCount = 2,
}: {
  value: KeyAction;
  onChange: (a: KeyAction) => void;
  kinds: readonly KeyActionKind[];
  macroSlots: number;
  query: string;
  onQuery: (q: string) => void;
  /** Firmware functions the driver offers as `special` actions (QMK Transparent, lighting keys …). */
  specials?: readonly { code: number; label: string }[];
  /** Layer keys are offered for layers that exist. */
  layerCount?: number;
}) {
  const t = useT();
  const [group, setGroup] = useState<KeycodeGroup | 'all'>('all');
  const entries = useMemo<KeycodeEntry[]>(
    () => [
      ...keycodeCatalog().filter((e) => e.action.kind !== 'layer' || e.action.layer < layerCount),
      ...specials.map((s) => ({
        id: `sp-${s.code}`,
        action: { kind: 'special' as const, code: s.code, label: s.label },
        name: s.label,
        group: 'special' as const,
        aliases: ['special', 'qmk'],
      })),
    ],
    [specials, layerCount],
  );
  const supported = useMemo(
    () => searchKeycodes(query, entries).filter((e) => kinds.includes(e.action.kind)),
    [query, kinds, entries],
  );
  const groups = useMemo(
    () => GROUPS.filter((g) => entries.some((e) => e.group === g && kinds.includes(e.action.kind))),
    [kinds, entries],
  );
  const results = group === 'all' ? supported : supported.filter((e) => e.group === group);
  const hidden = searchKeycodes(query, entries).length - supported.length;

  return (
    <div className="picker">
      <label className="search">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('keymap.searchPlaceholder')}
          aria-label={t('keymap.searchPlaceholder')}
        />
      </label>
      <div className="chips" role="group" aria-label={t('keymap.groups')}>
        {(['all', ...groups] as const).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={group === g}
            className={`chip ${group === g ? 'on' : ''}`}
            onClick={() => setGroup(g)}
          >
            {t(`keygroup.${g}`)}
          </button>
        ))}
      </div>
      <ul className="key-results" aria-label={t('keymap.results')}>
        {results.slice(0, 160).map((e) => {
          const on = actionsEqual(e.action, value);
          return (
            <li key={e.id}>
              <button
                type="button"
                className={`key-result ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => onChange(e.action)}
              >
                <span>{e.name}</span>
                {e.qmk && <code className="muted">{e.qmk}</code>}
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="muted small key-empty">{t('keymap.noResults')}</li>}
      </ul>
      {hidden > 0 && <p className="small muted">{t('keymap.hiddenUnsupported', { n: hidden })}</p>}

      {value.kind === 'keyboard' && (
        <fieldset className="mods">
          <legend>{t('keymap.modifiers')}</legend>
          {Object.entries(MODIFIER_BITS).map(([name, bit]) => (
            <label key={name} className="check">
              <input
                type="checkbox"
                checked={(value.modifiers & bit) !== 0}
                onChange={(e) =>
                  onChange({
                    ...value,
                    modifiers: e.target.checked ? value.modifiers | bit : value.modifiers & ~bit,
                  })
                }
              />
              {name}
            </label>
          ))}
        </fieldset>
      )}

      {macroSlots > 0 && kinds.includes('macro') && (
        <fieldset className="macro-bind">
          <legend>{t('keymap.macro')}</legend>
          <div className="row wrap">
            <select
              aria-label={t('keymap.macroSlot')}
              value={value.kind === 'macro' ? value.index : ''}
              onChange={(e) =>
                onChange({
                  kind: 'macro',
                  index: Number(e.target.value),
                  mode: value.kind === 'macro' ? value.mode : 'once',
                  repeat: value.kind === 'macro' ? value.repeat : 0,
                })
              }
            >
              <option value="" disabled>
                {t('keymap.macroPick')}
              </option>
              {Array.from({ length: macroSlots }, (_, i) => (
                <option key={i} value={i}>
                  {t('macros.slot', { n: i + 1 })}
                </option>
              ))}
            </select>
            {value.kind === 'macro' && (
              <select
                aria-label={t('keymap.macroMode')}
                value={value.mode}
                onChange={(e) => onChange({ ...value, mode: e.target.value as MacroPlayMode })}
              >
                <option value="once">{t('keymap.mode.once')}</option>
                <option value="repeat">{t('keymap.mode.repeat')}</option>
                <option value="toggle">{t('keymap.mode.toggle')}</option>
              </select>
            )}
            {value.kind === 'macro' && value.mode === 'repeat' && (
              <input
                type="number"
                min={1}
                max={255}
                aria-label={t('keymap.repeat')}
                value={value.repeat || 1}
                onChange={(e) => onChange({ ...value, repeat: Number(e.target.value) })}
              />
            )}
          </div>
          <p className="small muted">{t('keymap.macroLocal')}</p>
        </fieldset>
      )}
    </div>
  );
}
