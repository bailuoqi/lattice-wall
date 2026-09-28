import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname);
const sourceRoot = resolve(root, 'source');
const stylesRoot = resolve(sourceRoot, 'styles');
const srcRoot = resolve(root, 'src');
const reflowsPath = resolve(sourceRoot, 'panel', 'geometry', 'blockReflows.json');

const maximumFileBytes = 512 * 1024;
const maximumPackageBytes = 2 * 1024 * 1024;
const panelScriptTargetBytes = 200 * 1024;
const licenseBanner = `/*! Lattice Wall | Copyright (c) 2026 Lattice Wall contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See LICENSE and NOTICE.md in the Workshop item for license and source information.
 */`;

try {
  await access(reflowsPath);
} catch {
  throw new Error('source/panel/geometry/blockReflows.json is missing. Run `npm run reflows` first.');
}

await build({
  absWorkingDir: root,
  entryPoints: { panel: 'source/panel/main.ts', albums: 'source/panel/albums/main.ts' },
  outdir: 'src',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  minify: true,
  treeShaking: true,
  legalComments: 'inline',
  banner: { js: licenseBanner },
  sourcemap: false,
  charset: 'utf8',
  logLevel: 'warning',
});

// Stylesheets are concatenated in filename order; use numeric prefixes (00-base.css, 10-wall.css, ...) to control cascade order.
const styleFiles = (await readdir(stylesRoot)).filter((name) => name.endsWith('.css')).sort();
if (styleFiles.length === 0) throw new Error('source/styles has no .css files');
const css = [licenseBanner + '\n'];
for (const name of styleFiles) {
  const content = await readFile(resolve(stylesRoot, name), 'utf8');
  css.push(`/* ${name} */\n${content.trim()}\n`);
}
await writeFile(resolve(srcRoot, 'panel.css'), css.join('\n'), 'utf8');

// Ship the license and source notice with the Workshop item, outside the sandbox assets.
for (const name of ['LICENSE', 'NOTICE.md']) {
  const text = await readFile(resolve(root, name), 'utf8');
  await writeFile(resolve(root, 'content', name), text.replace(/\r\n?/gu, '\n'), 'utf8');
}

let total = 0;
const report = [];
for (const name of (await readdir(srcRoot)).sort()) {
  const path = resolve(srcRoot, name);
  const content = await readFile(path, 'utf8');
  const normalized = content.replace(/\r\n?/gu, '\n');
  if (normalized !== content) await writeFile(path, normalized, 'utf8');
  const size = Buffer.byteLength(normalized, 'utf8');
  total += size;
  if (size > maximumFileBytes) throw new Error(`Packaged file exceeds 512 KiB: ${name} (${size} bytes)`);
  report.push(`  ${name.padEnd(12)} ${String(size).padStart(8)} B`);
}
if (total > maximumPackageBytes) throw new Error(`Packaged sources exceed 2 MiB: ${total} bytes`);

const panelScriptBytes = Buffer.byteLength(await readFile(resolve(srcRoot, 'panel.js'), 'utf8'), 'utf8');
console.log(`Built lattice-wall sandbox files (${total} bytes total):\n${report.join('\n')}`);
if (panelScriptBytes > panelScriptTargetBytes) {
  console.warn(`Warning: panel.js is ${panelScriptBytes} bytes, above the ${panelScriptTargetBytes} byte budget target.`);
}
