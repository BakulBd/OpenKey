import { diffCaptures, formatDiff } from './diff.js';
import { loadCapture } from './load.js';

const [beforeFile, afterFile, ...rest] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
  console.error(
    'usage: pnpm packet-diff <capture-before> <capture-after> [--json] [--only host|device]',
  );
  process.exit(2);
}
const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1] : undefined;
const filter = <T extends { packets: { direction: string }[] }>(c: T): T =>
  only
    ? {
        ...c,
        packets: c.packets.filter((p) =>
          only === 'host' ? p.direction === 'host->device' : p.direction === 'device->host',
        ),
      }
    : c;
const report = diffCaptures(
  filter(await loadCapture(beforeFile)),
  filter(await loadCapture(afterFile)),
);
console.log(rest.includes('--json') ? JSON.stringify(report, null, 2) : formatDiff(report));
