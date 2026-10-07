import { useMemo, useState } from 'react';
import { MODIFIER_BITS, actionsEqual, describeAction, searchKeycodes, usageName } from '@openkey/core';
import type { KeyAction, KeycodeGroup, MacroPlayMode } from '@openkey/core';
import { useT } from '../../i18n/i18n.js';
import { Icon } from '../../components/Icon.js';

const GROUPS: (KeycodeGroup | 'all')[] = ['all', 'letters', 'digits', 'function', 'navigation', 'editing', 'modifiers', 'punctuation', 'numpad', 'media', 'system', 'mouse', 'shortcuts', 'special'];

/** Searchable action picker. Keycode names are HID legends; group names and controls are translated. */
export function KeyPicker({
  value,
  onChange,
  macroSlots,
  query,
  onQuery,
}: {
  value: KeyAction;
  onChange: (a: KeyAction) => void;
  macroSlots: number;
  query: string;
  onQuery: (q: string) => void;
}) {
  const t = useT();
  const [group, setGroup] = useState<KeycodeGroup | 'all'>('all');
  const results = useMemo(() => {
    const r = searchKeycodes(query);
    return group === 'all' ? r : r.filter((e) => e.group === group);
  }, [query, group]);

  return (
    <div className="picker">
      <label className="search">
        <Icon name="search" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('keymap.searchPlaceholder')} aria-label={t('keymap.searchPlaceholder')} />
      </label>
      <div className="chips" role="tablist" aria-label={t('keymap.groups')}>
        {GROUPS.map((g) => (
          <button key={g} type="button" role="tab" aria-selected={group === g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>
            {t(`keygroup.${g}`)}
          </button>
        ))}
      </div>
      <ul className="key-results" aria-label={t('keymap.results')}>
        {results.slice(0, 160).map((e) => {
          const on = actionsEqual(e.action, value);
          return (
            <li key={e.id}>
              <button type="button" className={`key-result ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(e.action)}>
                <span>{e.name}</span>
                {e.qmk && <code className="muted">{e.qmk}</code>}
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="muted small">{t('keymap.noResults')}</li>}
      </ul>

      {value.kind === 'keyboard' && (
        <fieldset className="mods">
          <legend>{t('keymap.modifiers')}</legend>
          {Object.entries(MODIFIER_BITS).map(([name, bit]) => (
            <label key={name} className="check">
              <input
                type="checkbox"
                checked={(value.modifiers & bit) !== 0}
                onChange={(e) => onChange({ ...value, modifiers: e.target.checked ? value.modifiers | bit : value.modifiers & ~bit })}
              />
              {name}
            </label>
          ))}
        </fieldset>
      )}

      {macroSlots > 0 && (
        <fieldset className="macro-bind">
          <legend>{t('keymap.macro')}</legend>
          <div className="row">
            <select
              aria-label={t('keymap.macroSlot')}
              value={value.kind === 'macro' ? value.index : ''}
              onChange={(e) => onChange({ kind: 'macro', index: Number(e.target.value), mode: value.kind === 'macro' ? value.mode : 'once', repeat: value.kind === 'macro' ? value.repeat : 0 })}
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
              <select aria-label={t('keymap.macroMode')} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as MacroPlayMode })}>
                <option value="once">{t('keymap.mode.once')}</option>
                <option value="repeat">{t('keymap.mode.repeat')}</option>
                <option value="toggle">{t('keymap.mode.toggle')}</option>
              </select>
            )}
            {value.kind === 'macro' && value.mode === 'repeat' && (
              <input type="number" min={1} max={255} aria-label={t('keymap.repeat')} value={value.repeat || 1} onChange={(e) => onChange({ ...value, repeat: Number(e.target.value) })} />
            )}
          </div>
        </fieldset>
      )}
      <p className="small muted">
        {t('keymap.current')}: <strong>{describeAction(value, usageName)}</strong>
      </p>
    </div>
  );
}
