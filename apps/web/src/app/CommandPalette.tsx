import { useEffect, useMemo, useState } from 'react';
import { searchKeycodes } from '@openkey/core';
import { useKeyboard } from '../state/keyboard.js';
import { useT } from '../i18n/i18n.js';
import { ROUTES, routeVisibility } from './routes.js';
import { Dialog } from '../components/Dialog.js';
import { Icon } from '../components/Icon.js';
import type { IconName } from '../components/Icon.js';
import { setTheme, themePref } from '../state/theme.js';
import { listRecords } from '../state/db.js';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  keywords: string;
  run(): void;
}

/** Event a keycode search result sends to the keymap studio. */
export const KEYCODE_EVENT = 'openkey:keycode';

/** Ctrl/Cmd+K: commands, pages, keycodes and profiles in one searchable list. */
export function CommandPalette({ onClose, go }: { onClose: () => void; go: (r: string) => void }) {
  const t = useT();
  const kb = useKeyboard();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void listRecords('profile').then((rs) =>
      setProfiles(rs.map((r) => ({ id: r.id, name: r.name }))),
    );
  }, []);

  const commands = useMemo<Command[]>(() => {
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const caps = kb.device?.caps ?? null;
    const list: Command[] = [];
    if (!kb.session) {
      list.push({
        id: 'connect',
        label: t('action.connect'),
        icon: 'plug',
        keywords: 'connect keyboard webhid',
        run: done(() => void kb.connect()),
      });
      list.push({
        id: 'demo',
        label: t('action.demo'),
        icon: 'play',
        keywords: 'demo try simulate',
        run: done(() => void kb.connectDemo()),
      });
      list.push({
        id: 'inspect',
        label: t('action.inspect'),
        icon: 'lab',
        keywords: 'inspect unknown device diagnostics',
        run: done(() => void kb.inspect()),
      });
    } else {
      list.push({
        id: 'disconnect',
        label: t('action.disconnect'),
        icon: 'x',
        keywords: 'disconnect close',
        run: done(() => void kb.disconnect()),
      });
      list.push({
        id: 'read',
        label: t('palette.read'),
        icon: 'overview',
        keywords: 'read configuration refresh overview',
        run: done(() => go('overview')),
      });
    }
    for (const r of ROUTES) {
      if (routeVisibility(r, caps, !!kb.device, !!kb.session) === 'hide') continue;
      list.push({
        id: `go-${r.id}`,
        label: t(r.label),
        hint: t('palette.page'),
        icon: r.icon,
        keywords: `${r.id} page open`,
        run: done(() => go(r.id)),
      });
    }
    list.push({
      id: 'diagnostics',
      label: t('palette.diagnostics'),
      icon: 'lab',
      keywords: 'diagnostics support bundle export',
      run: done(() => go('lab')),
    });
    list.push({
      id: 'theme',
      label: t('palette.theme'),
      icon: 'settings',
      keywords: 'theme dark light',
      run: done(() => setTheme(themePref() === 'dark' ? 'light' : 'dark')),
    });
    for (const p of profiles)
      list.push({
        id: `profile-${p.id}`,
        label: t('palette.profile', { name: p.name }),
        icon: 'profiles',
        keywords: `profile switch ${p.name}`,
        run: done(() => go(`profiles?${p.id}`)),
      });
    return list;
  }, [go, kb, onClose, profiles, t]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cmds = needle
      ? commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle))
      : commands;
    const keys: Command[] = needle
      ? searchKeycodes(needle)
          .slice(0, 8)
          .map((k) => ({
            id: `key-${k.id}`,
            label: k.name,
            hint: [k.qmk, t('palette.keycode')].filter(Boolean).join(' · '),
            icon: 'keymap' as IconName,
            keywords: '',
            run: () => {
              onClose();
              go('keymap');
              setTimeout(() => dispatchEvent(new CustomEvent(KEYCODE_EVENT, { detail: k.id })), 50);
            },
          }))
      : [];
    return [...cmds, ...keys];
  }, [commands, go, onClose, q, t]);

  useEffect(() => setSel(0), [q]);

  return (
    <Dialog
      title={t('palette.title')}
      onClose={onClose}
      actions={<span className="muted small">{t('palette.help')}</span>}
    >
      <div className="palette">
        <label className="search">
          <Icon name="search" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[sel] ? `pc-${results[sel].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                results[sel]?.run();
              }
            }}
          />
        </label>
        <ul id="palette-list" role="listbox" className="palette-list">
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`pc-${c.id}`}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'on' : ''}
              onMouseEnter={() => setSel(i)}
              onClick={() => c.run()}
            >
              <Icon name={c.icon} />
              <span>{c.label}</span>
              {c.hint && <span className="muted small">{c.hint}</span>}
            </li>
          ))}
          {results.length === 0 && <li className="muted">{t('palette.empty')}</li>}
        </ul>
      </div>
    </Dialog>
  );
}
