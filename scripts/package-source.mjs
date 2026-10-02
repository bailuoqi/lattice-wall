// Release-only corresponding-source snapshot; it is data and is not loaded by the plug-in.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const workshop = JSON.parse(await readFile(resolve(root, 'content/echo.workshop.json'), 'utf8'));
const plugin = JSON.parse(await readFile(resolve(root, 'content/community.echo'), 'utf8'));
if (workshop.version !== packageJson.version || plugin.manifest.version !== packageJson.version) {
  throw new Error('Source snapshot and plug-in versions must match');
}
const paths = ['.gitignore', 'ASSET_SOURCES.md', 'CUSTOMIZE.md', 'LICENSE', 'NOTICE.md',
  'README.md', 'README.zh-CN.md', 'build.mjs', 'echo.workshop.project.json',
  'package.json', 'package-lock.json', 'preview.png', 'tsconfig.json',
  'content/community.echo', 'content/echo.workshop.json', 'content/LICENSE', 'content/NOTICE.md'];
async function collect(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Source symlink is not allowed: ${path}`);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Special source file is not allowed: ${path}`);
  }
}
for (const directory of ['source', 'scripts', 'src', '.echo-sdk']) await collect(directory);
const files = [];
for (const path of paths.sort()) {
  if (!(await lstat(resolve(root, path))).isFile()) throw new Error(`Invalid source file: ${path}`);
  let bytes = await readFile(resolve(root, path));
  // The archive cannot contain itself; its reconstructed manifest inventories the remaining files.
  if (path === 'content/echo.workshop.json') {
    const manifest = JSON.parse(bytes.toString('utf8'));
    manifest.files = manifest.files.filter(file => file.path !== 'SOURCE.json');
    bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  const encoding = path === 'preview.png' ? 'base64' : 'utf8';
  files.push({ path, encoding, sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes.toString(encoding) });
}
const snapshot = { format: 'lattice-wall-source', schemaVersion: 1, id: workshop.id,
  version: packageJson.version, generatedAt: new Date().toISOString(),
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
  build: ['npm ci', 'npm run check'], files };
const output = `${JSON.stringify(snapshot, null, 2)}\n`;
if (Buffer.byteLength(output) > 4 * 1024 * 1024) throw new Error('Source snapshot exceeds 4 MiB');
await writeFile(resolve(root, 'content/SOURCE.json'), output);
console.log(`Packaged corresponding source ${snapshot.version}: ${files.length} files, ${Buffer.byteLength(output)} bytes.`);
