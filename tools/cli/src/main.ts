import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  applyBackup,
  capabilitySummary,
  collectBackup,
  diffBackups,
  explainError,
  FEATURES,
  hex16,
  hexToRgb,
  macroToText,
  planRestore,
  rgbToHex,
  parseSupportBundle,
  validateBackup,
} from '@openkey/core';
import type {
  Direction,
  KeyboardDriver,
  KeymapState,
  LayerId,
  Macro,
  MacroEvent,
  PerKeyRgb,
  RgbConfig,
} from '@openkey/core';
import {
  analyzeDiagnostic,
  createDefaultRegistry,
  detectionVerdict,
  formatDetectionReport,
  formatVerdict,
} from '@openkey/protocols';
import type { ProbeLevel } from '@openkey/protocols';
import { fromRgb565le, prepareAnimation } from '@openkey/tft';
import { findKey, formatAction, parseActionSpec, parseKeyName } from './action-spec.js';
import {
  backupDir,
  confirm,
  connect,
  listGroups,
  makeLog,
  pickGroup,
  writeJsonFile,
} from './context.js';
import type { GlobalFlags } from './context.js';
import { loadFrames, savePng } from './images.js';
import { inspectText } from './inspect.js';

const HELP = `openkey – open-source configurator for the AJAZZ AK820 keyboard family

Usage: openkey <command> [options]

Discovery
  list                         List AK820-family HID devices (no I/O, no permissions needed)
  detect [--verbose]           Detect the protocol (--level descriptor|passive|handshake, default handshake)
                               Handshakes run automatically only for identities where they are known
                               to be harmless; allow one for another device with --allow-probe <adapter>
  info                         Device information, protocol, capabilities
  diagnostics                  Everything above plus descriptors and the packet log (--json)
  analyze <diagnostic.json>    Offline analysis of an exported diagnostic package (no device, no I/O)

Configuration (writes ask for confirmation unless --yes)
  keymap get [--layer base|fn]
  keymap set <key>=<action>... [--layer fn]     e.g. Caps=key:ctrl  F12=consumer:mute
  keymap reset [--layer base|fn]                Restore firmware defaults for a layer
  rgb get | rgb effects
  rgb set [--effect N|name] [--color #rrggbb] [--brightness N] [--speed N] [--direction left|right|up|down] [--colorful]
  perkey get | perkey set --all #rrggbb | perkey set <key>=#rrggbb...
  macro list | macro set <slot> "<events>" | macro clear
        events: "down:a,wait:20,up:a"  (key/mouse:left, wait in ms)
  settings get | settings set [--sleep 0-3] [--key-response 1-5] [--win-lock on|off] [--alt-tab-lock on|off] [--alt-f4-lock on|off]
  clock sync                                    Set the screen clock to the host time
  tft info
  tft upload <file.png|jpg|gif|pattern:NAME> [--fit cover|contain|stretch] [--dither] [--preview out.png]
        patterns: red green blue white black checkerboard gradient quadrants red-blue
  backup [file.json] | restore <file.json> [--dry-run]

Hardware verification (owner-run, one operation at a time; see docs/AK820_INVESTIGATION.md)
  verify per-key --experimental  Read the per-key table, write the same table back, read it again
                                 and compare. Saves a local evidence record; changes no statuses.

Global options
  --device <index|key>  --protocol <id>  --allow-probe <adapter-id>  --json  --verbose  --yes
  --experimental  --debug
  OPENKEY_DEBUG=1 prints every HID report.
`;

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      device: { type: 'string' },
      protocol: { type: 'string' },
      level: { type: 'string' },
      'allow-probe': { type: 'string', multiple: true, default: [] },
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      experimental: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      layer: { type: 'string', default: 'base' },
      effect: { type: 'string' },
      color: { type: 'string' },
      brightness: { type: 'string' },
      speed: { type: 'string' },
      direction: { type: 'string' },
      colorful: { type: 'boolean' },
      all: { type: 'string' },
      fit: { type: 'string', default: 'cover' },
      dither: { type: 'boolean', default: false },
      preview: { type: 'string' },
      sleep: { type: 'string' },
      'key-response': { type: 'string' },
      'win-lock': { type: 'string' },
      'alt-tab-lock': { type: 'string' },
      'alt-f4-lock': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'read-lighting': { type: 'boolean', default: false },
    },
  });
}

type Parsed = ReturnType<typeof parse>;

function flagsOf(p: Parsed): GlobalFlags {
  const v = p.values;
  return {
    ...(v.device ? { device: v.device } : {}),
    ...(v.protocol ? { protocol: v.protocol } : {}),
    ...(v.level ? { level: v.level as ProbeLevel } : {}),
    consent: v['allow-probe'] ?? [],
    json: !!v.json,
    verbose: !!v.verbose,
    yes: !!v.yes,
    experimental: !!v.experimental,
    debug: !!v.debug,
  };
}

const out = (flags: GlobalFlags, data: unknown, text: () => string): void => {
  console.log(flags.json ? JSON.stringify(data, null, 2) : text());
};

async function autoBackup(driver: KeyboardDriver): Promise<string> {
  const b = await collectBackup(driver, 'openkey-cli (automatic pre-write backup)');
  const file = path.join(backupDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeJsonFile(file, b);
  return file;
}

async function withDriver<T>(
  flags: GlobalFlags,
  fn: (d: KeyboardDriver) => Promise<T>,
): Promise<T> {
  const { driver } = await connect(flags);
  try {
    return await fn(driver);
  } finally {
    await driver.disconnect();
  }
}

async function cmdAnalyze(flags: GlobalFlags, file: string | undefined): Promise<void> {
  if (!file) throw new Error('Usage: openkey analyze <diagnostic.json>');
  const bundle = parseSupportBundle(await fs.readFile(file, 'utf8'));
  const registry = createDefaultRegistry();
  const a = await analyzeDiagnostic(bundle, registry);
  out(flags, { detection: a.detection, verdict: a.verdict, fingerprint: a.fingerprint }, () =>
    [
      formatDetectionReport(a.detection, flags.verbose),
      '',
      formatVerdict(a.verdict),
      ...(a.missingUsages ? [`(${a.missingUsages} collection usage(s) not recorded in the file)`] : []),
    ].join('\n'),
  );
}

async function cmdList(flags: GlobalFlags): Promise<void> {
  const groups = await listGroups();
  out(
    flags,
    groups.map((g, i) => ({
      index: i,
      key: g.key,
      identity: g.identity,
      transport: g.transportHint,
      platform: g.platform,
    })),
    () =>
      groups.length
        ? groups
            .map(
              (g, i) =>
                `[${i}] ${g.identity.productName}  ${g.identity.vendorId.toString(16).padStart(4, '0')}:${g.identity.productId.toString(16).padStart(4, '0')}  ${g.transportHint}  ${g.interfaces.length} HID interface(s)`,
            )
            .join('\n')
        : 'No AK820-family devices found.',
  );
}

async function cmdDetect(flags: GlobalFlags): Promise<void> {
  const group = await pickGroup(flags);
  const log = makeLog(flags);
  const registry = createDefaultRegistry();
  const report = await registry.detect(group, {
    level: flags.level ?? 'handshake',
    log,
    consent: flags.consent,
  });
  const verdict = detectionVerdict(report, registry);
  out(flags, { report, verdict, packets: log.toJSON() }, () =>
    [formatDetectionReport(report, flags.verbose), '', formatVerdict(verdict)].join('\n'),
  );
}

async function cmdInfo(flags: GlobalFlags, p: Parsed): Promise<void> {
  const { driver, detection } = await connect(flags);
  try {
    const info = await driver.getDeviceInfo();
    const caps = driver.getCapabilities();
    let perKey: PerKeyRgb | undefined;
    if (p.values['read-lighting'] && caps.perKeyRgb.read === 'device')
      perKey = await driver.getPerKeyRgb();
    out(
      flags,
      {
        info,
        capabilities: caps,
        detection: detection.selected,
        ...(perKey ? { perKeyRgb: perKey } : {}),
      },
      () => {
        const L = [
          `Detected device: ${info.model}`,
          `VID/PID: 0x${info.identity.vendorId.toString(16).padStart(4, '0').toUpperCase()}:0x${info.identity.productId.toString(16).padStart(4, '0').toUpperCase()}`,
          `Firmware: ${info.firmware.version ?? 'unknown'} (${info.firmware.source}; ${info.firmware.confidence})`,
          `Protocol: ${info.protocol.name} [${info.protocol.id}]`,
          `Transport: ${info.transport}`,
          `Evidence: ${detection.selected?.confidence ?? 'n/a'}`,
          '',
          'Capabilities:',
          ...FEATURES.filter((f) => caps[f].write || caps[f].read !== 'none').map(
            (f) =>
              `  ${f.padEnd(16)} read=${caps[f].read.padEnd(6)} write=${caps[f].write ? 'yes' : 'no '} ${caps[f].confidence}${caps[f].note ? `  – ${caps[f].note}` : ''}`,
          ),
          `  not available: ${FEATURES.filter((f) => !caps[f].write && caps[f].read === 'none').join(', ')}`,
          '',
          ...info.fields.map(
            (f) => `${f.label}: ${String(f.value)}  [${f.confidence}, ${f.source}]`,
          ),
        ];
        if (perKey)
          L.push(
            '',
            `Per-key colours read from device: ${Object.keys(perKey).length} LEDs, e.g. ${Object.entries(
              perKey,
            )
              .slice(0, 4)
              .map(([k, c]) => `${k}=${rgbToHex(c)}`)
              .join(' ')}`,
          );
        return L.join('\n');
      },
    );
  } finally {
    await driver.disconnect();
  }
}

async function cmdDiagnostics(flags: GlobalFlags): Promise<void> {
  const inspect = await inspectText();
  const group = await pickGroup(flags);
  const log = makeLog(flags);
  const report = await createDefaultRegistry().detect(group, {
    level: flags.level ?? 'handshake',
    log,
    consent: flags.consent,
  });
  out(flags, { inspect, detection: report, packets: log.toJSON() }, () =>
    [
      inspect,
      '',
      formatDetectionReport(report, true),
      '',
      'Packets:',
      ...log.toJSON().map((r) => JSON.stringify(r)),
    ].join('\n'),
  );
}

async function cmdKeymap(
  flags: GlobalFlags,
  p: Parsed,
  sub: string | undefined,
  args: string[],
): Promise<void> {
  const layer = (p.values.layer === 'fn' ? 'fn' : 'base') as LayerId;
  await withDriver(flags, async (d) => {
    const layout = d.getLayout();
    if (sub === 'get' || !sub) {
      const km = await d.getKeymap(layer);
      out(flags, km, () =>
        [
          `Layer: ${layer}   source: ${km.provenance}${km.provenance !== 'device' ? ' (the firmware cannot report its keymap; showing what OpenKey last wrote)' : ''}`,
          ...layout.keys.map(
            (k) =>
              `  ${k.label.padEnd(10)} #${String(k.slot).padEnd(4)} ${km.slots[k.slot] ? formatAction(km.slots[k.slot]!) : 'default'}`,
          ),
        ].join('\n'),
      );
      return;
    }
    if (sub === 'set' || sub === 'reset') {
      const current = await d.getKeymap(layer);
      const next: KeymapState =
        sub === 'reset'
          ? { layer, slots: {}, provenance: 'mirror' }
          : { layer, slots: { ...current.slots }, provenance: 'mirror' };
      for (const a of sub === 'set' ? args : []) {
        const [keyName, spec] = a.split('=');
        if (!keyName || !spec) throw new Error(`Expected <key>=<action>, got "${a}"`);
        const key = findKey(layout, keyName);
        const action = parseActionSpec(spec);
        if (action.kind === 'default') delete next.slots[key.slot];
        else next.slots[key.slot] = action;
        console.log(`  ${key.label} (#${key.slot}) → ${formatAction(action)}`);
      }
      if (
        !(await confirm(
          flags,
          `Write the ${layer} layer keymap (${Object.keys(next.slots).length} remapped keys)?`,
        ))
      )
        return;
      console.log(`Backup: ${await autoBackup(d)}`);
      await d.setKeymap(next);
      console.log('Keymap written.');
      return;
    }
    throw new Error(`Unknown keymap subcommand ${sub}`);
  });
}

async function cmdRgb(flags: GlobalFlags, p: Parsed, sub: string | undefined): Promise<void> {
  await withDriver(flags, async (d) => {
    const cat = d.getRgbEffects();
    if (sub === 'effects') {
      out(flags, cat, () =>
        cat.effects.map((e) => `${String(e.id).padStart(3)}  ${e.name}`).join('\n'),
      );
      return;
    }
    const cur = await d.getRgbConfig();
    if (sub === 'get' || !sub) {
      out(
        flags,
        cur,
        () =>
          `effect=${cur.effect} (${cat.effects.find((e) => e.id === cur.effect)?.name ?? 'custom'}) color=${rgbToHex(cur.color)} colorful=${cur.colorful} brightness=${cur.brightness} speed=${cur.speed} direction=${cur.direction}  [source: OpenKey mirror]`,
      );
      return;
    }
    const v = p.values;
    const effect =
      v.effect === undefined
        ? cur.effect
        : Number.isNaN(Number(v.effect))
          ? cat.effects.find((e) => e.name.toLowerCase() === v.effect!.toLowerCase())?.id
          : Number(v.effect);
    if (effect === undefined)
      throw new Error(`Unknown effect ${v.effect}; see "openkey rgb effects"`);
    const next: RgbConfig = {
      effect,
      color: v.color ? hexToRgb(v.color) : cur.color,
      colorful: v.colorful ?? cur.colorful,
      brightness: v.brightness !== undefined ? Number(v.brightness) : cur.brightness,
      speed: v.speed !== undefined ? Number(v.speed) : cur.speed,
      direction: (v.direction as Direction) ?? cur.direction,
    };
    if (!(await confirm(flags, `Set lighting to ${JSON.stringify(next)}?`))) return;
    await d.setRgbConfig(next);
    console.log('Lighting written.');
  });
}

async function cmdPerKey(
  flags: GlobalFlags,
  p: Parsed,
  sub: string | undefined,
  args: string[],
): Promise<void> {
  await withDriver(flags, async (d) => {
    const layout = d.getLayout();
    if (sub === 'get' || !sub) {
      const colors = await d.getPerKeyRgb();
      out(flags, colors, () =>
        layout.keys
          .filter((k) => k.light !== null)
          .map(
            (k) =>
              `  ${k.label.padEnd(10)} LED ${String(k.light).padEnd(4)} ${colors[k.light!] ? rgbToHex(colors[k.light!]!) : '-'}`,
          )
          .join('\n'),
      );
      return;
    }
    const colors: PerKeyRgb = {};
    if (p.values.all)
      for (const k of layout.keys) if (k.light !== null) colors[k.light] = hexToRgb(p.values.all);
    for (const a of args) {
      const [keyName, hex] = a.split('=');
      const key = findKey(layout, keyName!);
      if (key.light === null) throw new Error(`${key.label} has no LED`);
      colors[key.light] = hexToRgb(hex!);
    }
    if (
      !(await confirm(
        flags,
        `Write per-key colours for ${Object.keys(colors).length} LEDs (switches the effect to per-key)?`,
      ))
    )
      return;
    await d.setPerKeyRgb(colors);
    console.log('Per-key colours written.');
  });
}

function parseMacroEvents(text: string): MacroEvent[] {
  return text.split(',').map((tok) => {
    const [kind, arg] = tok.trim().split(':');
    switch (kind) {
      case 'wait':
        return { type: 'delay' as const, ms: Number(arg) };
      case 'down':
      case 'up':
        if (arg?.startsWith('mouse-'))
          return {
            type: 'mouse' as const,
            button: arg.slice(6) as 'left' | 'right' | 'middle',
            down: kind === 'down',
          };
        return { type: 'key' as const, usage: parseKeyName(arg!), down: kind === 'down' };
      default:
        throw new Error(`Bad macro token "${tok}"`);
    }
  });
}

async function cmdMacro(
  flags: GlobalFlags,
  sub: string | undefined,
  args: string[],
): Promise<void> {
  await withDriver(flags, async (d) => {
    const macros = await d.getMacros();
    if (sub === 'list' || !sub) {
      out(flags, macros, () =>
        macros.length
          ? macros
              .map((m) => `  #${m.index}${m.name ? ` ${m.name}` : ''}: ${macroToText(m)}`)
              .join('\n')
          : 'No macros (as last written by OpenKey).',
      );
      return;
    }
    let next: Macro[];
    if (sub === 'clear') next = [];
    else if (sub === 'set') {
      const slot = Number(args[0]);
      const events = parseMacroEvents(args[1] ?? '');
      next = [...macros.filter((m) => m.index !== slot), { index: slot, events }];
    } else throw new Error(`Unknown macro subcommand ${sub}`);
    if (!(await confirm(flags, `Write ${next.length} macro(s) (replaces all on-device macros)?`)))
      return;
    console.log(`Backup: ${await autoBackup(d)}`);
    await d.setMacros(next);
    console.log('Macros written.');
  });
}

const onOff = (v: string | undefined) =>
  v === undefined ? undefined : /^(on|yes|1|true)$/i.test(v);

async function cmdSettings(flags: GlobalFlags, p: Parsed, sub: string | undefined): Promise<void> {
  await withDriver(flags, async (d) => {
    const cur = await d.getSystemSettings();
    const schema = d.getSettingsSchema();
    if (sub === 'get' || !sub) {
      out(flags, { settings: cur, schema }, () =>
        [
          `sleep: ${schema.sleepTime?.find((o) => o.value === cur.sleepTime)?.label ?? cur.sleepTime}`,
          `key response: ${schema.keyResponseTime?.find((o) => o.value === cur.keyResponseTime)?.label ?? cur.keyResponseTime}`,
          `win key disabled: ${cur.disableWinKey}  alt+tab disabled: ${cur.disableAltTab}  alt+f4 disabled: ${cur.disableAltF4}`,
          '[source: OpenKey mirror – the firmware does not report settings]',
        ].join('\n'),
      );
      return;
    }
    const v = p.values;
    const next = {
      ...cur,
      ...(v.sleep !== undefined ? { sleepTime: Number(v.sleep) } : {}),
      ...(v['key-response'] !== undefined ? { keyResponseTime: Number(v['key-response']) } : {}),
      ...(onOff(v['win-lock']) !== undefined ? { disableWinKey: onOff(v['win-lock'])! } : {}),
      ...(onOff(v['alt-tab-lock']) !== undefined
        ? { disableAltTab: onOff(v['alt-tab-lock'])! }
        : {}),
      ...(onOff(v['alt-f4-lock']) !== undefined ? { disableAltF4: onOff(v['alt-f4-lock'])! } : {}),
    };
    if (!(await confirm(flags, `Write settings ${JSON.stringify(next)}?`))) return;
    await d.setSystemSettings(next);
    console.log('Settings written.');
  });
}

async function cmdTft(
  flags: GlobalFlags,
  p: Parsed,
  sub: string | undefined,
  args: string[],
): Promise<void> {
  await withDriver(flags, async (d) => {
    const info = await d.getTftInfo();
    if (sub === 'info' || !sub) {
      const st = await d.getTftStatus();
      out(
        flags,
        { info, status: st },
        () =>
          `${info.width}×${info.height} ${info.pixelFormat}, up to ${info.maxFrames} frames, delay ${info.minDelayMs}–${info.maxDelayMs} ms in ${info.delayUnitMs} ms steps, ${info.slots} slot(s)${st.lastUpload ? `\nLast upload by OpenKey: ${st.lastUpload.frames} frame(s) at ${st.lastUpload.at}` : ''}`,
      );
      return;
    }
    if (sub !== 'upload') throw new Error(`Unknown tft subcommand ${sub}`);
    const src = args[0];
    if (!src) throw new Error('tft upload needs a file or pattern:<name>');
    const frames = await loadFrames(src, info.width, info.height);
    const prepared = prepareAnimation(frames, info, {
      fit: p.values.fit as 'cover',
      dither: !!p.values.dither,
    });
    if (p.values.preview)
      await savePng(
        p.values.preview,
        fromRgb565le(prepared.frames[0]!.pixels, info.width, info.height),
      );
    console.log(
      `${prepared.frames.length} frame(s)${prepared.dropped ? `, ${prepared.dropped} dropped to fit ${info.maxFrames}` : ''}${prepared.clampedDelays ? `, ${prepared.clampedDelays} delay(s) clamped` : ''}`,
    );
    if (
      !(await confirm(
        flags,
        'Upload to the keyboard screen (replaces the current user animation)?',
      ))
    )
      return;
    const t0 = Date.now();
    await d.uploadTftGif(prepared.frames, (pr) => {
      if (pr.phase === 'transfer') process.stdout.write(`\r  chunk ${pr.sent}/${pr.total}`);
    });
    console.log(`\nUploaded in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  });
}

/**
 * Per-key round trip: the lowest-risk way to verify a write on firmware that can read it back.
 * Writing the colours the keyboard already has changes no key colour, but the official write
 * sequence first switches the lighting effect to the per-key table (0x80), and the previous effect
 * cannot be read back. The user is told before anything is sent.
 */
async function cmdVerify(flags: GlobalFlags, sub: string | undefined): Promise<void> {
  if (sub !== 'per-key') throw new Error('Usage: openkey verify per-key --experimental');
  if (!flags.experimental) throw new Error('This writes to the keyboard with a not-yet-verified command; pass --experimental to confirm you want to verify it.');
  const { driver, detection, log, group } = await connect(flags);
  try {
    const caps = driver.getCapabilities();
    if (caps.perKeyRgb.read !== 'device' || !caps.perKeyRgb.write)
      throw new Error(`${detection.selected?.protocolId ?? 'this adapter'} cannot read per-key colours back; nothing to verify.`);
    const ok = await confirm(
      flags,
      [
        'This will:',
        '  1. read the per-key colour table (verified command; the official sequence ends with SAVE),',
        '  2. write the SAME table back (switches the lighting effect to per-key mode; note your current',
        '     effect now: it cannot be read back and you may need to re-select it on the keyboard),',
        '  3. read it again and compare.',
        'Key colours do not change. Continue?',
      ].join('\n'),
    );
    if (!ok) return;
    const before = await driver.getPerKeyRgb();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir(), `per-key-before-verify-${stamp}.json`);
    await writeJsonFile(backupFile, before);
    console.log(`Current colours saved to ${backupFile}`);
    let writeError: string | null = null;
    try {
      await driver.setPerKeyRgb(before);
    } catch (e) {
      writeError = explainError(e).title;
    }
    const after = writeError ? null : await driver.getPerKeyRgb();
    const differences = after
      ? Object.keys(before).filter((k) => JSON.stringify(before[Number(k)]) !== JSON.stringify(after[Number(k)]))
      : [];
    const outcome = writeError ? 'FAILED' : differences.length ? 'MISMATCH' : 'VERIFIED';
    const evidence = {
      description: 'Per-key colour write verified by read-back (openkey verify per-key)',
      date: new Date().toISOString().slice(0, 10),
      device: `${group.identity.productName} (${hex16(group.identity.vendorId)}:${hex16(group.identity.productId)})`,
      firmware: group.identity.release !== undefined ? `bcdDevice ${hex16(group.identity.release)}` : 'unknown',
      transport: group.transportHint,
      adapter: detection.selected?.protocolId,
      outcome,
      ...(writeError ? { error: writeError } : {}),
      differences,
      note: 'Contains your per-key colour values. Review before sharing. Promote evidence only after review (docs/HARDWARE_TEST_MATRIX.md).',
      packets: log.toJSON(),
    };
    const evidenceFile = path.join(backupDir(), `evidence-per-key-${stamp}.json`);
    await writeJsonFile(evidenceFile, evidence);
    console.log(`Outcome: ${outcome}${writeError ? ` (${writeError})` : differences.length ? ` (${differences.length} LEDs differ)` : ''}`);
    console.log(`Evidence record: ${evidenceFile}`);
  } finally {
    await driver.disconnect();
  }
}

async function cmdBackup(flags: GlobalFlags, args: string[]): Promise<void> {
  await withDriver(flags, async (d) => {
    const b = await collectBackup(d, 'openkey-cli');
    const file =
      args[0] ?? path.join(backupDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeJsonFile(file, b);
    console.log(`Backup written to ${file}`);
    console.log(
      `Sections: ${
        Object.entries(b.provenance)
          .map(([s, src]) => `${s} (${src})`)
          .join(', ') || 'none'
      }`,
    );
  });
}

async function cmdRestore(flags: GlobalFlags, p: Parsed, args: string[]): Promise<void> {
  const file = args[0];
  if (!file) throw new Error('restore needs a backup file');
  const v = validateBackup(JSON.parse(await fs.readFile(file, 'utf8')));
  for (const w of v.warnings) console.log(`warning: ${w}`);
  if (!v.ok || !v.backup) throw new Error(`Invalid backup: ${v.errors.join('; ')}`);
  await withDriver(flags, async (d) => {
    const plan = planRestore(v.backup!, await d.getDeviceInfo(), d.getCapabilities());
    for (const w of plan.warnings) console.log(`warning: ${w}`);
    if (!plan.compatible) throw new Error(plan.blocked.join(' '));
    const current = await collectBackup(d);
    const changes = diffBackups(current, v.backup!);
    console.log(
      `Sections to restore: ${plan.sections.join(', ') || 'none'}; ${changes.length} change(s):`,
    );
    for (const c of changes.slice(0, 40))
      console.log(`  ${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
    if (p.values['dry-run']) return;
    if (!(await confirm(flags, 'Apply this backup?'))) return;
    console.log(`Pre-restore backup: ${await autoBackup(d)}`);
    console.log(`Restored: ${(await applyBackup(d, v.backup!, plan)).join(', ')}`);
  });
}

async function main(): Promise<void> {
  let p: Parsed;
  try {
    p = parse(process.argv.slice(2));
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    console.error(HELP);
    process.exit(2);
  }
  const [cmd, sub, ...rest] = p.positionals;
  const flags = flagsOf(p);
  if (p.values.help || !cmd) {
    console.log(HELP);
    return;
  }
  switch (cmd) {
    case 'list':
      return cmdList(flags);
    case 'detect':
      return cmdDetect(flags);
    case 'analyze':
      return cmdAnalyze(flags, sub);
    case 'info':
      return cmdInfo(flags, p);
    case 'diagnostics':
      return cmdDiagnostics(flags);
    case 'keymap':
      return cmdKeymap(flags, p, sub, rest);
    case 'rgb':
      return cmdRgb(flags, p, sub);
    case 'perkey':
      return cmdPerKey(flags, p, sub, rest);
    case 'verify':
      return cmdVerify(flags, sub);
    case 'macro':
      return cmdMacro(flags, sub, rest);
    case 'settings':
      return cmdSettings(flags, p, sub);
    case 'tft':
      return cmdTft(flags, p, sub, rest);
    case 'clock':
      return withDriver(flags, async (d) => {
        if (!(await confirm(flags, 'Set the keyboard clock to the host time?'))) return;
        await d.syncClock(new Date());
        console.log('Clock synchronised.');
      });
    case 'backup':
      return cmdBackup(flags, sub ? [sub, ...rest] : rest);
    case 'restore':
      return cmdRestore(flags, p, sub ? [sub, ...rest] : rest);
    case 'capabilities':
      return withDriver(flags, async (d) =>
        out(flags, d.getCapabilities(), () =>
          JSON.stringify(capabilitySummary(d.getCapabilities()), null, 2),
        ),
      );
    default:
      console.error(`Unknown command "${cmd}"\n`);
      console.error(HELP);
      process.exit(2);
  }
}

main().catch((e) => {
  const x = explainError(e);
  console.error(`Error: ${x.title}\n  ${x.detail}${x.hint ? `\n  Hint: ${x.hint}` : ''}`);
  if (process.env.OPENKEY_DEBUG === '1' && e instanceof Error) console.error(e.stack);
  process.exit(1);
});
