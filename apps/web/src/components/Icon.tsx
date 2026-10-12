/** Minimal stroke icon set (24×24, currentColor). Decorative unless a label is given. */
const PATHS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  keymap: 'M3 6h18v12H3zM6 9h2M10 9h2M14 9h2M18 9h0M6 12h2M10 12h2M14 12h2M8 15h8',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  rgb: 'M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 004-4c0-4.4-4-8-9-8zM7.5 11.5h0M10 7.5h0M15 7.5h0',
  paint: 'M4 20l5-1 10-10-4-4L5 15l-1 5zM14 6l4 4',
  macros: 'M4 6h16M4 12h10M4 18h7M17 15l4 3-4 3z',
  screen: 'M4 5h16v11H4zM9 20h6M12 16v4',
  device:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2L6 8.5 4 8 3 11l2 1v0l-2 1 1 3 2-.5L7.5 17 7 19l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z',
  backup: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  profiles: 'M4 7h16M4 12h16M4 17h10',
  tester: 'M5 8h14v8H5zM8 11h0M12 11h0M16 11h0M9 14h6',
  latency: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 7v5l3 2',
  lab: 'M9 3h6M10 3v6L5 19a1 1 0 001 1h12a1 1 0 001-1l-5-10V3',
  compat: 'M4 6h16M4 12h16M4 18h16M9 4v16',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  plug: 'M9 3v5M15 3v5M7 8h10v4a5 5 0 01-10 0zM12 17v4',
  play: 'M7 4l13 8-13 8z',
  github:
    'M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 00-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  terminal: 'M3 5h18v14H3zM7 9l3 3-3 3M12 15h5',
  warn: 'M12 3l10 18H2zM12 10v4M12 17h0',
  info: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 11v6M12 7h0',
  menu: 'M4 7h16M4 12h16M4 17h16',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  label,
  size = 18,
}: {
  name: IconName;
  label?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className="icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
