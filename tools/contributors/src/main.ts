/**
 * Refreshes the footer's contributor wall (pnpm contributors): the GitHub contributors of the
 * repository, with 96 px avatars downloaded into apps/web/public/contributors/. The site serves
 * them itself, so visitors' browsers never contact GitHub and the CSP stays `img-src 'self'`.
 * Bots are left out. Maintainers run it now and then; it is not part of the build.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'BakulBd/openkey';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'apps/web/public/contributors');
const OUT = path.join(ROOT, 'apps/web/src/app/contributors.json');
const SIZE = 96;

interface ApiContributor {
  login: string;
  type: string;
  contributions: number;
  avatar_url: string;
  html_url: string;
}

async function main(): Promise<void> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=100`, {
    headers: { 'User-Agent': 'openkey-contributors', Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status}`);
  const people = ((await r.json()) as ApiContributor[]).filter(
    (c) => c.type === 'User' && !c.login.endsWith('[bot]'),
  );
  await mkdir(DIR, { recursive: true });
  // Avatars of people no longer listed are removed; nothing else in the folder is touched.
  const keep = new Set(people.map((c) => `${c.login.toLowerCase()}.png`));
  for (const f of await readdir(DIR))
    if (f.endsWith('.png') && !keep.has(f)) await rm(path.join(DIR, f));
  const list = [];
  for (const c of people) {
    const img = await fetch(`${c.avatar_url}${c.avatar_url.includes('?') ? '&' : '?'}s=${SIZE}`);
    if (!img.ok) throw new Error(`Avatar of ${c.login}: HTTP ${img.status}`);
    const file = `${c.login.toLowerCase()}.png`;
    await writeFile(path.join(DIR, file), new Uint8Array(await img.arrayBuffer()));
    list.push({
      login: c.login,
      url: c.html_url,
      avatar: `contributors/${file}`,
      contributions: c.contributions,
    });
  }
  await writeFile(OUT, `${JSON.stringify({ repo: REPO, contributors: list }, null, 2)}\n`);
  console.log(`${list.length} contributor(s) → ${path.relative(ROOT, OUT)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
