/**
 * Builds packages/devices/src/via-index.json: the USB identity and name of every keyboard with a
 * VIA definition in the-via/keyboards, so the model finder can say "this board works through VIA"
 * and the doctor can recognise it. Maintainers run it now and then (pnpm via-index); it is not part
 * of the build.
 *
 * the-via/keyboards is GPL-3.0. Only facts are kept (USB vendor/product IDs, product names and the
 * vendor folder); no definition content is copied. Layouts are fetched from usevia.app at the
 * user's request, as before.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'the-via/keyboards';
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/devices/src/via-index.json',
);
const CONCURRENCY = 8;

interface Tree {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string }[];
}

const hex = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? n : null;
};
const id = (vid: number, pid: number) =>
  `${vid.toString(16).toUpperCase().padStart(4, '0')}:${pid.toString(16).toUpperCase().padStart(4, '0')}`;

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': 'openkey-via-index' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function main(): Promise<void> {
  const head = await json<{ object: { sha: string } }>(
    `https://api.github.com/repos/${REPO}/git/ref/heads/master`,
  );
  const sha = head.object.sha;
  const tree = await json<Tree>(
    `https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`,
  );
  if (tree.truncated)
    throw new Error('The repository tree was truncated; refusing a partial index.');
  const files = tree.tree
    .filter((e) => e.type === 'blob' && /^v[23]\/.+\.json$/.test(e.path))
    .map((e) => e.path)
    // v3 first, so a board defined in both keeps its current name.
    .sort((a, b) =>
      a.startsWith('v3/') === b.startsWith('v3/')
        ? a.localeCompare(b)
        : a.startsWith('v3/')
          ? -1
          : 1,
    );

  const boards = new Map<string, [string, string, string]>();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]!;
      try {
        const d = await json<Record<string, unknown>>(
          `https://raw.githubusercontent.com/${REPO}/${sha}/${file}`,
        );
        const vid = hex(d.vendorId);
        const pid = hex(d.productId);
        const name = typeof d.name === 'string' ? d.name.trim() : '';
        if (vid === null || pid === null || !name) continue;
        const key = id(vid, pid);
        if (!boards.has(key)) boards.set(key, [key, name, file.split('/')[1]!]);
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failed > files.length / 20) throw new Error(`${failed} of ${files.length} files failed.`);

  const out = {
    source: `${REPO}@${sha.slice(0, 12)}`,
    license: 'Facts only (USB IDs, names) from a GPL-3.0 repository; no definition content.',
    generated: new Date().toISOString().slice(0, 10),
    boards: [...boards.values()].sort((a, b) => a[0].localeCompare(b[0])),
  };
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  console.log(`${out.boards.length} boards from ${files.length} files (${failed} failed) → ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
