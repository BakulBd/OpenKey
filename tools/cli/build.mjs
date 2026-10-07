// Bundles the CLI into a single ESM file. node-hid stays external (native module).
import { build } from 'esbuild';
await build({
  entryPoints: ['tools/cli/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'tools/cli/dist/openkey.mjs',
  external: ['node-hid'],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
