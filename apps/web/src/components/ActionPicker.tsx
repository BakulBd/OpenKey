import { useState } from 'react';
import { MODIFIER_BITS, consumerUsages, keyboardUsages } from '@openkey/core';
import type { KeyAction, MouseAction } from '@openkey/core';

const MOUSE: [MouseAction, string][] = [
  ['left', 'Left click'],
  ['right', 'Right click'],
  ['middle', 'Middle click'],
  ['left+right', 'Double click'],
  ['back', 'Button 4 (back)'],
  ['forward', 'Button 5 (forward)'],
  ['wheel-up', 'Scroll up'],
  ['wheel-down', 'Scroll down'],
];

type Kind = 'default' | 'disabled' | 'keyboard' | 'consumer' | 'mouse' | 'macro';

export function ActionPicker({
  value,
  onChange,
  macroSlots,
  allowDisable = true,
}: {
  value: KeyAction;
  onChange: (a: KeyAction) => void;
  macroSlots: number;
  allowDisable?: boolean;
}) {
  const [kind, setKind] = useState<Kind>(
    (['default', 'disabled', 'keyboard', 'consumer', 'mouse', 'macro'] as const).includes(
      value.kind as Kind,
    )
      ? (value.kind as Kind)
      : 'default',
  );
  const kb =
    value.kind === 'keyboard' ? value : { kind: 'keyboard' as const, usage: 0x04, modifiers: 0 };
  const choose = (k: Kind) => {
    setKind(k);
    if (k === 'default' || k === 'disabled') onChange({ kind: k });
    if (k === 'keyboard') onChange(kb);
    if (k === 'consumer')
      onChange(value.kind === 'consumer' ? value : { kind: 'consumer', usage: 0xcd });
    if (k === 'mouse') onChange(value.kind === 'mouse' ? value : { kind: 'mouse', action: 'left' });
    if (k === 'macro')
      onChange(
        value.kind === 'macro' ? value : { kind: 'macro', index: 0, mode: 'once', repeat: 0 },
      );
  };
  return (
    <div className="picker">
      <div className="seg">
        {(
          [
            'default',
            ...(allowDisable ? ['disabled'] : []),
            'keyboard',
            'consumer',
            'mouse',
            'macro',
          ] as Kind[]
        ).map((k) => (
          <button
            key={k}
            className={kind === k ? 'on' : ''}
            onClick={() => choose(k)}
            type="button"
          >
            {
              {
                default: 'Default',
                disabled: 'Disable',
                keyboard: 'Key',
                consumer: 'Media',
                mouse: 'Mouse',
                macro: 'Macro',
              }[k]
            }
          </button>
        ))}
      </div>
      {kind === 'keyboard' && (
        <div className="picker-body">
          <select
            value={kb.usage}
            onChange={(e) => onChange({ ...kb, usage: Number(e.target.value) })}
          >
            {keyboardUsages().map((u) => (
              <option key={u.usage} value={u.usage}>
                {u.name}
              </option>
            ))}
          </select>
          <div className="mods">
            {Object.entries(MODIFIER_BITS).map(([name, bit]) => (
              <label key={name} className="chk">
                <input
                  type="checkbox"
                  checked={(kb.modifiers & bit) !== 0}
                  onChange={(e) =>
                    onChange({
                      ...kb,
                      modifiers: e.target.checked ? kb.modifiers | bit : kb.modifiers & ~bit,
                    })
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </div>
      )}
      {kind === 'consumer' && value.kind === 'consumer' && (
        <select
          value={value.usage}
          onChange={(e) => onChange({ kind: 'consumer', usage: Number(e.target.value) })}
        >
          {consumerUsages().map((u) => (
            <option key={u.usage} value={u.usage}>
              {u.name}
            </option>
          ))}
        </select>
      )}
      {kind === 'mouse' && value.kind === 'mouse' && (
        <select
          value={value.action}
          onChange={(e) => onChange({ kind: 'mouse', action: e.target.value as MouseAction })}
        >
          {MOUSE.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
      {kind === 'macro' && value.kind === 'macro' && (
        <div className="picker-body row">
          <select
            value={value.index}
            onChange={(e) => onChange({ ...value, index: Number(e.target.value) })}
          >
            {Array.from({ length: macroSlots }, (_, i) => (
              <option key={i} value={i}>
                Macro {i + 1}
              </option>
            ))}
          </select>
          <select
            value={value.mode}
            onChange={(e) => onChange({ ...value, mode: e.target.value as 'once' })}
          >
            <option value="once">Play once</option>
            <option value="repeat">Repeat N times</option>
            <option value="toggle">Until pressed again</option>
          </select>
          {value.mode === 'repeat' && (
            <input
              type="number"
              min={1}
              max={255}
              value={value.repeat || 1}
              onChange={(e) => onChange({ ...value, repeat: Number(e.target.value) })}
            />
          )}
        </div>
      )}
    </div>
  );
}
