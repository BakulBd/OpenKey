/** Writes docs/MODEL_GUIDE.md and docs/RESEARCH_INVENTORY.md (pnpm docs:guide). */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelGuideMarkdown, researchInventoryMarkdown } from './render.js';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
await writeFile(path.join(docs, 'MODEL_GUIDE.md'), modelGuideMarkdown());
await writeFile(path.join(docs, 'RESEARCH_INVENTORY.md'), researchInventoryMarkdown());
console.log('docs/MODEL_GUIDE.md and docs/RESEARCH_INVENTORY.md written; run prettier on them.');
