#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, cp, lstat, mkdir, readFile, readdir, watch, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { officialExampleProjects, createCustomizeGuide, createGitignore } from '../lib/author-guide.mjs';
import {
  addLyricsSlot,
  addPluginPermission,
  addRuntimeCapability,
  addVisualizerColor,
  applyEntryPreset,
  applyEntrySet,
  describeNextMoves,
  inferKindPreset,
  inferProjectIdentity,
} from '../lib/author-actions.mjs';
import {
  attentionFromQuality,
  formatExplain,
  formatGateSummary,
  formatKinds,
  formatNextMoves,
  formatNextSteps,
  formatQualityReport,
  formatTestReport,
  hintForError,
} from '../lib/cli-report.mjs';
import {
  createVsCodeSnippetsFile,
  findSnippet,
  formatSnippet,
  formatSnippetList,
  snippetNames,
  workshopSnippets,
} from '../lib/snippets.mjs';
import { formatCommandHelp, usage } from '../lib/command-help.mjs';
import { formatGuide, formatGuideTopics, guideTopics } from '../lib/guide.mjs';
import { resolveRecipe, workshopRecipes } from '../lib/recipes.mjs';
import { buildQualityReport } from '../lib/quality-report.mjs';
import { startMockHost, testWorkshopItem } from '../lib/mock-host.mjs';
import { createDebouncedRunner, isGeneratedWorkshopChange } from '../lib/watch-utils.mjs';
import { validateWorkshopNetworkDeclaration } from '../lib/network-policy.mjs';
import { validateNativeShellEntry } from '../lib/native-shell.mjs';
import { createListingPreviewPng } from '../lib/preview-png.mjs';
import { animationLibraryMinEchoVersion } from '../lib/animation-preview.mjs';
import { lyricsPageStyles, visualizerStyles } from '../lib/kind-presets.mjs';
import {
  createKindExtraFiles,
  createTemplateEntry,
  defaultPresetForKind,
  inspectProject,
  resolveTemplatePreset,
  templateEntryForKind,
  templateTagForKind,
  workshopTemplateKinds,
} from '../lib/project-templates.mjs';
import {
  defaultMinEchoVersionForPreset,
  dspPresets,
  isEchoVersionAtLeast,
  lyricsStylePresets,
  pluginPresets,
  stylesheetMinEchoVersion,
  themePresets,
  visualizerPresets,
} from '../lib/theme-assets.mjs';
import {
  createFullTrustPluginSourceFiles,
  fullTrustMinimumEchoVersion,
  fullTrustPluginPreset,
  trustedEntryFileName,
  trustedRuntimeStarterSource,
} from '../lib/trusted-plugin.mjs';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestFileName = 'echo.workshop.json';
const projectFileName = 'echo.workshop.project.json';
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9a-z]+(?:[.-][0-9a-z]+)*)?$/iu;
const idPattern = /^[a-z0-9](?:[a-z0-9._-]{1,78}[a-z0-9])?$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const pluginPackageLimits = JSON.parse(await readFile(resolve(sdkRoot, 'contracts', 'plugin-package-limits.json'), 'utf8'));
const pluginApiContract = JSON.parse(await readFile(resolve(sdkRoot, 'contracts', 'plugin-api.json'), 'utf8'));
const maximumPluginPackageBytes = Number(pluginPackageLimits.maximumPackageBytes);
const maximumPluginFiles = Number(pluginPackageLimits.maximumFiles);
const maximumPluginFileBytes = Number(pluginPackageLimits.maximumFileBytes);
const allowedSourceExtensions = new Set(pluginPackageLimits.supportedAssetExtensions);
const externalAssetPrefix = String(pluginPackageLimits.externalAssetPrefix);
const maximumExternalAssetFileBytes = Number(pluginPackageLimits.maximumExternalAssetFileBytes);
const maximumExternalAssetBytes = Number(pluginPackageLimits.maximumExternalAssetBytes);
const allowedExternalAssetExtensions = new Set(pluginPackageLimits.supportedExternalAssetExtensions);
const nativeShellLimits = JSON.parse(await readFile(resolve(sdkRoot, 'contracts', 'native-shell-limits.json'), 'utf8'));
const maximumNativeShellPackageBytes = Number(nativeShellLimits.maximumPackageBytes);
const maximumNativeShellFiles = Number(nativeShellLimits.maximumFiles);
const maximumNativeShellFileBytes = Number(nativeShellLimits.maximumFileBytes);
const allowedNativeShellExtensions = new Set(nativeShellLimits.supportedAssetExtensions);
const previewPng = createListingPreviewPng();
const booleanFlags = new Set(['json', 'warn-only', 'help']);

const fail = (message) => { throw new Error(message); };
const normalizeText = (value, field, maximum) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maximum) fail(`${field} is invalid`);
  return text;
};
const parseArguments = (values) => {
  const positional = [];
  const options = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const name = value.slice(2);
    if (booleanFlags.has(name)) { options.set(name, 'true'); continue; }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) fail(`Missing value for ${value}`);
    options.set(name, next);
    index += 1;
  }
  return { positional, options };
};
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const hash = (content) => createHash('sha256').update(content).digest('hex');
const toSlash = (value) => value.split('\\').join('/');
const isSafeRelativePath = (value) => typeof value === 'string'
  && value.length > 0 && value.length <= 240 && !isAbsolute(value) && !value.includes('\\')
  && !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
const projectPath = (root, value, field) => {
  if (!isSafeRelativePath(value)) fail(`${field} is unsafe`);
  const path = resolve(root, ...value.split('/'));
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) fail(`${field} escapes the project`);
  return path;
};

const projectConfigKeys = new Set([
  '$schema', 'schemaVersion', 'appId', 'publishedFileId', 'contentDirectory',
  'previewFile', 'visibility', 'description', 'changeNote', 'tags',
]);
const validateProjectConfig = (project) => {
  if (!project || typeof project !== 'object' || Array.isArray(project)) fail('Project configuration must be an object');
  const unsupported = Object.keys(project).filter((key) => !projectConfigKeys.has(key));
  if (unsupported.length > 0) fail(`Project configuration has unsupported fields: ${unsupported.join(', ')}`);
  if (project.schemaVersion !== 1 || project.appId !== '5105090'
    || !/^(?:0|[1-9]\d{0,19})$/u.test(project.publishedFileId)) fail('Project configuration identity is invalid');
  if (!isSafeRelativePath(project.contentDirectory) || project.contentDirectory.length > 160) fail('Project contentDirectory is invalid');
  if (!isSafeRelativePath(project.previewFile) || project.previewFile.length > 160
    || !/\.(?:gif|jpe?g|png)$/iu.test(project.previewFile)) fail('Project previewFile is invalid');
  if (!['private', 'friends-only', 'unlisted', 'public'].includes(project.visibility)) fail('Project visibility is invalid');
  if (typeof project.description !== 'string' || !project.description.trim() || project.description.length > 8000) {
    fail('Project description is invalid');
  }
  if (typeof project.changeNote !== 'string' || !project.changeNote.trim() || project.changeNote.length > 8000) {
    fail('Project changeNote is invalid');
  }
  if (!Array.isArray(project.tags) || project.tags.length < 1 || project.tags.length > 8
    || new Set(project.tags).size !== project.tags.length
    || project.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) {
    fail('Project tags are invalid');
  }
  return project;
};

const writeRelativeFiles = async (root, files) => {
  for (const file of files) {
    const path = projectPath(root, file.path, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, 'utf8');
  }
};

const collectSourceFiles = async (root, current = root) => {
  const output = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) fail(`Source symlink is not allowed: ${entry.name}`);
    if (entry.isDirectory()) { output.push(...await collectSourceFiles(root, path)); continue; }
    if (!entry.isFile()) fail(`Special source file is not allowed: ${entry.name}`);
    const relativePath = toSlash(relative(root, path));
    if (!allowedSourceExtensions.has(extname(relativePath).toLowerCase())) fail(`Unsupported source file: ${relativePath}`);
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > maximumPluginFileBytes) {
      fail(`Source file exceeds ${maximumPluginFileBytes} bytes: ${relativePath}`);
    }
    output.push({ path: relativePath, content });
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
};

const collectContentInventory = async (root, current = root, kind = null) => {
  const output = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) fail(`Content symlink is not allowed: ${entry.name}`);
    if (entry.isDirectory()) { output.push(...await collectContentInventory(root, path, kind)); continue; }
    if (!entry.isFile()) fail(`Special content file is not allowed: ${entry.name}`);
    const relativePath = toSlash(relative(root, path));
    if (relativePath.toLowerCase() === manifestFileName) continue;
    const content = await readFile(path);
    const normalizedPath = relativePath.toLowerCase();
    const isExternalPluginAsset = kind === 'plugin-package' && normalizedPath.startsWith(externalAssetPrefix);
    const maximumBytes = kind === 'native-shell'
      ? maximumNativeShellFileBytes
      : isExternalPluginAsset ? maximumExternalAssetFileBytes : 16 * 1024 * 1024;
    if (content.byteLength > maximumBytes) fail(`Content file exceeds ${maximumBytes} bytes: ${relativePath}`);
    if (isExternalPluginAsset && !allowedExternalAssetExtensions.has(extname(relativePath).toLowerCase())) {
      fail(`Unsupported external plug-in asset: ${relativePath}`);
    }
    if (kind === 'native-shell' && !allowedNativeShellExtensions.has(extname(relativePath).toLowerCase())) {
      fail(`Unsupported native-shell asset: ${relativePath}`);
    }
    output.push({ path: relativePath, size: content.byteLength, sha256: hash(content) });
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
};

const validatePackage = (value, expectedId, expectedApiVersion) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'echo-plugin-package' || value.version !== 1) fail('community.echo has an invalid package header');
  const manifest = value.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('community.echo manifest is missing');
  if (manifest.id !== expectedId || !idPattern.test(manifest.id)) fail('Plug-in id must match the outer manifest');
  if (!versionPattern.test(manifest.version) || ![1, 2].includes(manifest.apiVersion)) fail('Plug-in version or apiVersion is unsupported');
  if (expectedApiVersion !== undefined && manifest.apiVersion !== expectedApiVersion) fail('Inner and outer plug-in apiVersion must match');
  if (!isSafeRelativePath(manifest.entry) || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > maximumPluginFiles) fail('Plug-in entry or files are invalid');
  const paths = new Set();
  for (const file of value.files) {
    if (!file || !isSafeRelativePath(file.path) || typeof file.content !== 'string'
      || !allowedSourceExtensions.has(extname(file.path).toLowerCase())
      || Buffer.byteLength(file.content) > maximumPluginFileBytes) fail('Plug-in file is invalid');
    const key = file.path.toLowerCase();
    if (paths.has(key)) fail(`Duplicate plug-in file: ${file.path}`);
    paths.add(key);
  }
  if (!paths.has(manifest.entry.toLowerCase())) fail('Plug-in entry is not packaged');
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const trustedEntry = typeof manifest.trustedEntry === 'string' ? manifest.trustedEntry.trim() : '';
  if (permissions.includes('system:full') !== Boolean(trustedEntry)) {
    fail('system:full and manifest.trustedEntry must be declared together');
  }
  if (trustedEntry) {
    if (!isSafeRelativePath(trustedEntry) || extname(trustedEntry).toLowerCase() !== '.mjs') {
      fail('manifest.trustedEntry must be a safe .mjs path');
    }
    if (!paths.has(trustedEntry.toLowerCase())) fail('Plug-in trustedEntry is not packaged');
  }
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > maximumPluginPackageBytes) fail('Plug-in package exceeds the host byte limit');
};

const validateProject = async (rootInput) => {
  const root = resolve(rootInput);
  const project = validateProjectConfig(await readJson(resolve(root, projectFileName)));
  const contentRoot = projectPath(root, project.contentDirectory, 'contentDirectory');
  const manifest = await readJson(resolve(contentRoot, manifestFileName));
  if (manifest.type !== 'echo-workshop-item' || manifest.schemaVersion !== 1 || !idPattern.test(manifest.id)) fail('Outer manifest header is invalid');
  if (!versionPattern.test(manifest.version) || !workshopTemplateKinds.includes(manifest.content?.kind) || !isSafeRelativePath(manifest.content.entry)) fail('Outer manifest content is invalid');
  if (!versionPattern.test(manifest.compatibility?.minEchoVersion)) fail('Compatibility declaration is invalid');
  if (manifest.content.kind === 'plugin-package' && ![1, 2].includes(manifest.compatibility?.pluginApiVersion)) fail('Plug-in compatibility declaration is invalid');
  if (!Array.isArray(manifest.files) || manifest.files.length < 1
    || manifest.files.length > (manifest.content.kind === 'native-shell' ? maximumNativeShellFiles : 512)) {
    fail('Outer manifest file inventory is invalid');
  }
  const inventory = await collectContentInventory(contentRoot, contentRoot, manifest.content.kind);
  const totalBytes = inventory.reduce((total, file) => total + file.size, 0);
  const maximumTotalBytes = manifest.content.kind === 'plugin-package'
    ? maximumExternalAssetBytes
    : manifest.content.kind === 'native-shell'
      ? maximumNativeShellPackageBytes
      : 64 * 1024 * 1024;
  if (totalBytes > maximumTotalBytes) fail(`Workshop content exceeds ${maximumTotalBytes} bytes`);
  const expected = new Map(inventory.map((file) => [file.path.toLowerCase(), file]));
  for (const file of manifest.files) {
    const actual = expected.get(String(file.path).toLowerCase());
    if (!actual || actual.size !== file.size || actual.sha256 !== file.sha256 || !sha256Pattern.test(file.sha256)) fail(`Manifest hash mismatch: ${file.path}`);
    expected.delete(String(file.path).toLowerCase());
  }
  if (expected.size > 0) fail(`Manifest is missing files: ${[...expected.values()].map((file) => file.path).join(', ')}`);
  const packagePath = projectPath(contentRoot, manifest.content.entry, 'content.entry');
  const packageText = await readFile(packagePath, 'utf8');
  if (manifest.content.kind === 'plugin-package' && Buffer.byteLength(packageText, 'utf8') > maximumPluginPackageBytes) {
    fail('Plug-in package exceeds the host byte limit');
  }
  const entry = JSON.parse(packageText);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Workshop entry must be a JSON object');
  if (manifest.content.kind === 'plugin-package') {
    validatePackage(entry, manifest.id, manifest.compatibility.pluginApiVersion);
    if (entry.manifest.permissions?.includes('system:full')
      && !isEchoVersionAtLeast(manifest.compatibility.minEchoVersion, fullTrustMinimumEchoVersion)) {
      fail(`system:full requires minEchoVersion ${fullTrustMinimumEchoVersion} or newer`);
    }
  }
  if (manifest.content.kind === 'native-shell') validateNativeShellEntry(entry, manifest.id);
  validateWorkshopNetworkDeclaration(manifest, entry);
  const previewPath = projectPath(root, project.previewFile, 'previewFile');
  const preview = await lstat(previewPath);
  if (!preview.isFile() || preview.size < 1 || preview.size >= 1024 * 1024 || !['.gif', '.jpeg', '.jpg', '.png'].includes(extname(previewPath).toLowerCase())) fail('Preview must be JPG, PNG or GIF under 1 MB');
  return { root, id: manifest.id, files: inventory.length, project, manifest, entry, contentRoot };
};

const syncProject = async (rootInput) => {
  const root = resolve(rootInput);
  const project = await readJson(resolve(root, projectFileName));
  const contentRoot = projectPath(root, project.contentDirectory, 'contentDirectory');
  const manifestPath = resolve(contentRoot, manifestFileName);
  const manifest = await readJson(manifestPath);
  if (manifest.content?.kind === 'plugin-package') {
    const sourceFiles = await collectSourceFiles(resolve(root, 'src'));
    const existingPackage = await readJson(projectPath(contentRoot, manifest.content.entry, 'content.entry'));
    const packageValue = { ...existingPackage, files: sourceFiles };
    validatePackage(packageValue, manifest.id, manifest.compatibility?.pluginApiVersion);
    await writeJson(projectPath(contentRoot, manifest.content.entry, 'content.entry'), packageValue);
  }
  await writeJson(manifestPath, {
    ...manifest,
    files: await collectContentInventory(contentRoot, contentRoot, manifest.content?.kind),
  });
  return validateProject(root);
};

const createProjectReadme = (title, kind, preset, entryPath) => `# ${title}

Template: \`${kind}\`${preset ? ` / preset \`${preset}\`` : ''}.

Edit \`${kind === 'plugin-package' ? (preset === fullTrustPluginPreset ? 'src/plugin.js and src/trusted.mjs' : 'src/plugin.js') : `content/${entryPath}`}\`, then run \`npm run next\` to see what the host still allows. \`add\`, \`set\` and \`scaffold\` keep customizing without rewriting the whole file.

Use your own Node 20+ environment and install or build any third-party dependencies yourself. ECHO Workshop Authoring Studio checks, previews and publishes the verified package; it does not provision or manage an author development environment.

Packaged CSS must be scoped to \`html[data-workshop-theme-pack="<id>"]\`. A stylesheet or runtime theme should declare \`minEchoVersion\` ${stylesheetMinEchoVersion} or newer.

Open the project in ECHO Workshop Authoring Studio to publish. These local commands never upload anything.
`;

const sdkPackageVersion = async () => {
  const descriptor = await readJson(resolve(sdkRoot, 'echo-workshop-sdk.json'));
  return descriptor.packageVersion;
};

const copyPortableSdk = async (echoSdkRoot) => {
  await mkdir(resolve(echoSdkRoot, 'bin'), { recursive: true });
  await mkdir(resolve(echoSdkRoot, 'contracts'), { recursive: true });
  await mkdir(resolve(echoSdkRoot, 'schemas'), { recursive: true });
  await cp(resolve(sdkRoot, 'echo-workshop-plugin.d.ts'), resolve(echoSdkRoot, 'echo-workshop-plugin.d.ts'));
  await cp(resolve(sdkRoot, 'echo-workshop-ui-runtime.d.ts'), resolve(echoSdkRoot, 'echo-workshop-ui-runtime.d.ts'));
  await cp(resolve(sdkRoot, 'echo-workshop-native-shell.d.ts'), resolve(echoSdkRoot, 'echo-workshop-native-shell.d.ts'));
  await cp(resolve(sdkRoot, 'echo-workshop-animation-library.d.ts'), resolve(echoSdkRoot, 'echo-workshop-animation-library.d.ts'));
  await cp(resolve(sdkRoot, 'bin', 'echo-workshop-sdk.mjs'), resolve(echoSdkRoot, 'bin', 'echo-workshop-sdk.mjs'));
  await cp(resolve(sdkRoot, 'bin', 'echo-workshop-sdk.cmd'), resolve(echoSdkRoot, 'bin', 'echo-workshop-sdk.cmd'));
  await cp(resolve(sdkRoot, 'lib'), resolve(echoSdkRoot, 'lib'), { recursive: true });
  await cp(resolve(sdkRoot, 'contracts'), resolve(echoSdkRoot, 'contracts'), { recursive: true });
  await cp(resolve(sdkRoot, 'schemas'), resolve(echoSdkRoot, 'schemas'), { recursive: true });
  await writeJson(resolve(echoSdkRoot, 'sdk-version.json'), { packageVersion: await sdkPackageVersion() });
};

const pngSize = (buffer) => {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

const initProject = async (rootInput, options) => {
  const root = resolve(rootInput);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0) fail('Target directory must be empty');
  const inferred = inferProjectIdentity(basename(root));
  const recipe = options.has('recipe') ? resolveRecipe(options.get('recipe')) : null;
  const id = String(options.get('id') ?? inferred.id).trim().toLowerCase();
  if (!idPattern.test(id)) fail('Project id is invalid');
  const title = String(options.get('title') ?? inferred.title).trim();
  const holder = String(options.get('holder') ?? inferred.holder).trim();
  if (!title || title.length > 120) fail('title is invalid');
  if (!holder || holder.length > 160) fail('holder is invalid');
  const licenseId = normalizeText(options.get('license') ?? 'All-Rights-Reserved', '--license', 80);
  const kind = recipe?.kind ?? String(options.get('kind') ?? 'plugin-package');
  if (!workshopTemplateKinds.includes(kind)) fail(`Unsupported template kind: ${kind}`);
  const preset = resolveTemplatePreset(kind, options.get('preset') ?? recipe?.preset);
  const minVersion = normalizeText(
    options.get('min-version') ?? (kind === 'animation-library'
      ? animationLibraryMinEchoVersion
      : defaultMinEchoVersionForPreset(preset)),
    '--min-version',
    48,
  );
  if (!versionPattern.test(minVersion)) fail('Minimum ECHO version is invalid');
  await mkdir(resolve(root, 'content'), { recursive: true });
  await mkdir(resolve(root, '.github', 'workflows'), { recursive: true });
  await mkdir(resolve(root, '.vscode'), { recursive: true });
  if (kind === 'plugin-package') {
    await mkdir(resolve(root, 'src'), { recursive: true });
    if (preset === 'complete') {
      await cp(resolve(sdkRoot, 'templates', 'plugin-complete'), resolve(root, 'src'), { recursive: true });
    } else if (preset === 'catalog') {
      await cp(resolve(sdkRoot, 'templates', 'plugin-catalog'), resolve(root, 'src'), { recursive: true });
    } else if (preset === 'lyrics') {
      await cp(resolve(sdkRoot, 'templates', 'plugin-lyrics'), resolve(root, 'src'), { recursive: true });
    } else if (preset === fullTrustPluginPreset) {
      await writeRelativeFiles(resolve(root, 'src'), createFullTrustPluginSourceFiles());
    } else {
      await cp(resolve(sdkRoot, 'templates', 'plugin-basic', 'plugin.js'), resolve(root, 'src', 'plugin.js'));
    }
  }
  await cp(resolve(sdkRoot, 'templates', 'github', 'validate-workshop.yml'), resolve(root, '.github', 'workflows', 'validate-workshop.yml'));
  await copyPortableSdk(resolve(root, '.echo-sdk'));
  const entryPath = templateEntryForKind(kind);
  await writeJson(resolve(root, 'content', entryPath), createTemplateEntry(kind, id, title, preset));
  await writeRelativeFiles(resolve(root, 'content'), createKindExtraFiles(kind, preset, id, title));
  await writeJson(resolve(root, 'content', manifestFileName), {
    type: 'echo-workshop-item', schemaVersion: 1, id, title, version: '1.0.0',
    content: { kind, entry: entryPath },
    compatibility: { minEchoVersion: minVersion, ...(kind === 'plugin-package' ? { pluginApiVersion: 2 } : {}) }, files: [],
    license: { id: licenseId, holder },
  });
  await writeJson(resolve(root, projectFileName), {
    schemaVersion: 1, appId: '5105090', publishedFileId: '0', contentDirectory: 'content',
    previewFile: 'preview.png', visibility: 'private', description: `${title} for ECHO. Generated by the portable Workshop SDK so you can customize appearance, lyrics, DSP or a sandboxed plug-in before publishing.`,
    changeNote: 'Initial private test upload.', tags: [templateTagForKind(kind)],
  });
  await writeFile(resolve(root, 'preview.png'), previewPng);
  await writeJson(resolve(root, 'package.json'), {
    name: id, version: '1.0.0', private: true, type: 'module',
    scripts: {
      sync: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs sync .',
      check: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs check .',
      quality: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs quality .',
      test: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs test .',
      inspect: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs inspect .',
      explain: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs explain .',
      next: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs next .',
      guide: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs guide',
      snippet: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs snippet',
      fix: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs fix .',
      upgrade: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs upgrade .',
      watch: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs watch .',
      dev: 'node ./.echo-sdk/bin/echo-workshop-sdk.mjs dev .',
    },
  });
  await writeJson(resolve(root, 'tsconfig.json'), {
    compilerOptions: { allowJs: true, checkJs: true, noEmit: true, strict: true, target: 'ES2022', lib: ['ES2022', 'DOM'] },
    include: ['src/**/*.js', 'src/**/*.mjs', 'content/ui/**/*.js', '.echo-sdk/**/*.d.ts'],
  });
  await writeJson(resolve(root, '.vscode', 'settings.json'), {
    'json.schemas': [
      { fileMatch: ['/echo.workshop.project.json'], url: './.echo-sdk/schemas/project.schema.json' },
      { fileMatch: ['/content/echo.workshop.json'], url: './.echo-sdk/schemas/echo.workshop.schema.json' },
      { fileMatch: ['/content/theme.json'], url: './.echo-sdk/schemas/theme.schema.json' },
      { fileMatch: ['/content/community.echo'], url: './.echo-sdk/schemas/plugin-package.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('lyrics-style')}`], url: './.echo-sdk/schemas/lyrics-style.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('animation-library')}`], url: './.echo-sdk/schemas/animation-library.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('visualizer-preset')}`], url: './.echo-sdk/schemas/visualizer.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('dsp-preset')}`], url: './.echo-sdk/schemas/dsp.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('audio-plugin-profile')}`], url: './.echo-sdk/schemas/audio-plugin-profile.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('locale-pack')}`], url: './.echo-sdk/schemas/locale-pack.schema.json' },
      { fileMatch: [`/content/${templateEntryForKind('native-shell')}`], url: './.echo-sdk/schemas/native-shell.schema.json' },
    ],
  });
  await writeJson(resolve(root, '.vscode', 'echo-workshop.code-snippets'), createVsCodeSnippetsFile());
  await writeJson(resolve(root, '.vscode', 'tasks.json'), {
    version: '2.0.0',
    tasks: [
      {
        label: 'ECHO Workshop: Check',
        type: 'npm',
        script: 'check',
        problemMatcher: [],
        group: { kind: 'build', isDefault: true },
        presentation: { reveal: 'always', panel: 'dedicated', clear: true },
      },
      {
        label: 'ECHO Workshop: Dev console',
        type: 'npm',
        script: 'dev',
        isBackground: true,
        problemMatcher: [],
        runOptions: { instanceLimit: 1 },
        presentation: { reveal: 'always', panel: 'dedicated' },
      },
      {
        label: 'ECHO Workshop: Next moves',
        type: 'npm',
        script: 'next',
        problemMatcher: [],
        presentation: { reveal: 'always', panel: 'shared', clear: true },
      },
    ],
  });
  await writeFile(resolve(root, 'README.md'), createProjectReadme(title, kind, preset, entryPath), 'utf8');
  await writeFile(resolve(root, 'CUSTOMIZE.md'), createCustomizeGuide(kind, preset, id), 'utf8');
  await writeFile(resolve(root, '.gitignore'), createGitignore(), 'utf8');
  return { ...await syncProject(root), kind, preset };
};

const scaffoldProject = async (rootInput, options) => {
  const current = await validateProject(rootInput);
  const kind = current.manifest.content.kind;
  const preset = resolveTemplatePreset(kind, options.get('preset') ?? fail('Missing --preset'));
  if (kind === 'theme' && preset === 'colors') fail('colors is the base layer and is already present');
  const existing = inferKindPreset(kind, current.entry);
  if (kind === 'theme' && existing === preset) fail(`This project already has the ${preset} layer`);
  if (kind !== 'theme' && existing === preset) fail(`This project already uses the ${preset} starter`);
  const entryPath = projectPath(current.contentRoot, current.manifest.content.entry, 'content.entry');
  const applied = applyEntryPreset(kind, preset, current.entry);
  await writeJson(entryPath, applied.entry);
  await writeRelativeFiles(current.contentRoot, applied.extraFiles);
  if (kind === 'theme' && (preset === 'stylesheet' || preset === 'runtime')) {
    const manifestPath = resolve(current.contentRoot, manifestFileName);
    const manifest = await readJson(manifestPath);
    if (!isEchoVersionAtLeast(manifest.compatibility?.minEchoVersion, stylesheetMinEchoVersion)) {
      await writeJson(manifestPath, {
        ...manifest,
        compatibility: { ...manifest.compatibility, minEchoVersion: stylesheetMinEchoVersion },
      });
    }
  }
  return syncProject(current.root);
};

const addToProject = async (rootInput, options, positional) => {
  const current = await validateProject(rootInput);
  const kind = current.manifest.content.kind;
  const slot = options.get('slot') ?? (positional[2] === 'slot' ? positional[3] : null);
  const capability = options.get('capability') ?? (positional[2] === 'capability' ? positional[3] : null);
  const color = options.get('color') ?? (positional[2] === 'color' ? positional[3] : null);
  const permission = options.get('permission') ?? (positional[2] === 'permission' ? positional[3] : null);
  let nextEntry = current.entry;
  let change = '';
  if (slot) {
    if (kind !== 'lyrics-style') fail('Slots can only be added to lyrics-style projects');
    nextEntry = addLyricsSlot(current.entry, slot);
    change = `Added lyrics slot ${slot}`;
  } else if (capability) {
    if (kind !== 'theme') fail('Capabilities can only be added to theme UI runtimes');
    nextEntry = addRuntimeCapability(current.entry, capability);
    change = `Added UI capability ${capability}`;
  } else if (color) {
    if (kind !== 'visualizer-preset') fail('Colors can only be added to visualizer palettes');
    nextEntry = addVisualizerColor(current.entry, color);
    change = `Added palette color ${String(color).toLowerCase()}`;
  } else if (permission) {
    if (kind !== 'plugin-package') fail('Permissions can only be added to plug-in packages');
    nextEntry = addPluginPermission(current.entry, permission);
    change = `Added plug-in permission ${permission}`;
  } else {
    fail('add needs --slot, --capability, --color or --permission');
  }
  await writeJson(projectPath(current.contentRoot, current.manifest.content.entry, 'content.entry'), nextEntry);
  if (permission === 'system:full') {
    const trustedEntry = nextEntry.manifest?.trustedEntry ?? trustedEntryFileName;
    const trustedPath = projectPath(resolve(current.root, 'src'), trustedEntry, 'manifest.trustedEntry');
    try {
      await access(trustedPath, fsConstants.F_OK);
    } catch {
      await mkdir(dirname(trustedPath), { recursive: true });
      await writeFile(trustedPath, trustedRuntimeStarterSource, 'utf8');
    }
    if (!isEchoVersionAtLeast(current.manifest.compatibility?.minEchoVersion, fullTrustMinimumEchoVersion)) {
      await writeJson(resolve(current.contentRoot, manifestFileName), {
        ...current.manifest,
        compatibility: {
          ...current.manifest.compatibility,
          minEchoVersion: fullTrustMinimumEchoVersion,
        },
      });
    }
  }
  return { ...await syncProject(current.root), change };
};

const setProjectFields = async (rootInput, options) => {
  const current = await validateProject(rootInput);
  const kind = current.manifest.content.kind;
  const updates = {};
  if (options.has('title')) updates.title = normalizeText(options.get('title'), '--title', 120);
  if (options.has('description')) updates.description = normalizeText(options.get('description'), '--description', 400);
  if (options.has('style')) {
    if (kind !== 'visualizer-preset') fail('--style is only for visualizer-preset projects');
    const style = options.get('style');
    if (!visualizerStyles.includes(style)) fail(`style must be ${visualizerStyles.join('|')}`);
    updates.style = style;
  }
  if (options.has('background')) {
    if (kind !== 'lyrics-style') fail('--background is only for lyrics-style projects');
    updates.background = options.get('background');
  }
  if (options.has('page-style')) {
    if (kind !== 'lyrics-style') fail('--page-style is only for lyrics-style projects');
    const pageStyle = options.get('page-style');
    if (!lyricsPageStyles.includes(pageStyle)) fail(`page-style must be a host lyricsPageStyle`);
    updates.pageStyle = pageStyle;
  }
  if (options.has('preamp')) {
    if (kind !== 'dsp-preset') fail('--preamp is only for dsp-preset projects');
    const preampDb = Number(options.get('preamp'));
    if (!Number.isFinite(preampDb) || preampDb < -12 || preampDb > 6) fail('--preamp must be between -12 and 6');
    updates.preampDb = preampDb;
  }
  if (options.has('bars')) {
    if (kind !== 'visualizer-preset') fail('--bars is only for visualizer-preset projects');
    const barCount = Number(options.get('bars'));
    if (!Number.isInteger(barCount) || barCount < 8 || barCount > 128) fail('--bars must be an integer from 8 to 128');
    updates.barCount = barCount;
  }
  if (options.has('mirror')) {
    if (kind !== 'visualizer-preset') fail('--mirror is only for visualizer-preset projects');
    const mirror = String(options.get('mirror'));
    if (!['true', 'false'].includes(mirror)) fail('--mirror must be true or false');
    updates.mirror = mirror === 'true';
  }
  const licenseId = options.has('license') ? normalizeText(options.get('license'), '--license', 80) : null;
  if (Object.keys(updates).length === 0 && !licenseId) fail('set needs at least one field');
  if (Object.keys(updates).length > 0) {
    const nextEntry = applyEntrySet(kind, current.entry, updates);
    await writeJson(projectPath(current.contentRoot, current.manifest.content.entry, 'content.entry'), nextEntry);
  }
  if (updates.title || licenseId) {
    const manifestPath = resolve(current.contentRoot, manifestFileName);
    const manifest = await readJson(manifestPath);
    await writeJson(manifestPath, {
      ...manifest,
      ...(updates.title ? { title: updates.title } : {}),
      ...(licenseId ? { license: { ...manifest.license, id: licenseId } } : {}),
    });
  }
  return syncProject(current.root);
};

const gateRollup = (id, quality, tests) => ({
  ok: quality.ok && tests.ok,
  id,
  gate: {
    qualityPass: quality.summary.pass,
    qualityWarnings: quality.summary.warning,
    qualityBlockers: quality.summary.blocker,
    fixturesPassed: (tests.checks ?? []).filter((check) => check.ok).length,
    fixturesTotal: (tests.checks ?? []).length,
  },
});

const watchProject = async (rootInput) => {
  const first = await syncProject(rootInput);
  const watchPath = first.manifest.content.kind === 'plugin-package' ? 'src' : first.project.contentDirectory;
  const runOnce = async () => {
    const result = await syncProject(rootInput);
    const tests = await runItemTests(result);
    const quality = await buildQualityReport(result.root, result.project, result.manifest, result.entry);
    return { id: result.id, tests, quality };
  };
  const printReport = (report) => {
    console.log(formatTestReport(report.tests));
    console.log(formatQualityReport(report.quality));
    console.log(formatGateSummary(gateRollup(report.id, report.quality, report.tests)));
  };
  let report = await runOnce();
  printReport(report);
  const watcher = watch(resolve(first.root, watchPath), { recursive: true });
  console.log(`[echo-workshop-sdk] Watching ${watchPath}. These local reruns never upload.`);
  const runner = createDebouncedRunner({
    run: async (changedFile) => {
      report = await runOnce();
      console.log(`\n[echo-workshop-sdk] Changed ${changedFile}`);
      printReport(report);
    },
    onError: (error) => {
      console.error(`[echo-workshop-sdk] ${error instanceof Error ? error.message : String(error)}`);
      const hint = hintForError(error instanceof Error ? error.message : String(error));
      if (hint) console.error(hint);
    },
  });
  for await (const event of watcher) {
    if (isGeneratedWorkshopChange(event.filename)) continue;
    runner.schedule(event.filename);
  }
  runner.dispose();
};

const upgradeProject = async (rootInput) => {
  const root = resolve(rootInput);
  await access(resolve(root, projectFileName), fsConstants.R_OK);
  let previous = null;
  try { previous = (await readJson(resolve(root, '.echo-sdk', 'sdk-version.json'))).packageVersion; } catch { /* first upgrade */ }
  await copyPortableSdk(resolve(root, '.echo-sdk'));
  return { root, previous, current: await sdkPackageVersion() };
};

const copyOfficialExample = async (name, destinationInput) => {
  const example = officialExampleProjects.find((item) => item.name === name);
  if (!example) fail(`Unknown example: ${name}. Use: ${officialExampleProjects.map((item) => item.name).join(', ')}`);
  const destination = resolve(destinationInput);
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length > 0) fail('Target directory must be empty');
  await cp(resolve(sdkRoot, 'examples', example.name), destination, { recursive: true });
  await copyPortableSdk(resolve(destination, '.echo-sdk'));
  return { ...example, root: destination };
};

const fixProject = async (rootInput) => {
  const changes = [];
  const root = resolve(rootInput);
  const project = await readJson(resolve(root, projectFileName));
  const contentRoot = projectPath(root, project.contentDirectory, 'contentDirectory');
  const previewBuffer = await readFile(projectPath(root, project.previewFile, 'previewFile')).catch(() => null);
  const size = previewBuffer ? pngSize(previewBuffer) : null;
  if (!previewBuffer || !size || size.width < 195 || size.height < 195) {
    await writeFile(projectPath(root, project.previewFile, 'previewFile'), createListingPreviewPng());
    changes.push(previewBuffer
      ? 'Replaced the listing preview with a 256x256 PNG.'
      : 'Created a 256x256 listing preview PNG.');
  }
  const manifestPath = resolve(contentRoot, manifestFileName);
  let manifest = await readJson(manifestPath);
  const entryPath = projectPath(contentRoot, manifest.content.entry, 'content.entry');
  let entry = await readJson(entryPath);
  if (manifest.content.kind === 'theme' && (entry.stylesheet || entry.runtime)
    && !isEchoVersionAtLeast(manifest.compatibility?.minEchoVersion, stylesheetMinEchoVersion)) {
    await writeJson(manifestPath, {
      ...manifest,
      compatibility: { ...manifest.compatibility, minEchoVersion: stylesheetMinEchoVersion },
    });
    changes.push(`Bumped minEchoVersion to ${stylesheetMinEchoVersion}.`);
  }
  if (manifest.content.kind === 'animation-library'
    && !isEchoVersionAtLeast(manifest.compatibility?.minEchoVersion, animationLibraryMinEchoVersion)) {
    await writeJson(manifestPath, {
      ...manifest,
      compatibility: { ...manifest.compatibility, minEchoVersion: animationLibraryMinEchoVersion },
    });
    changes.push(`Bumped minEchoVersion to ${animationLibraryMinEchoVersion}.`);
  }
  if (manifest.content.kind === 'plugin-package'
    && entry.manifest?.permissions?.includes('system:full')) {
    const trustedEntry = typeof entry.manifest.trustedEntry === 'string' && entry.manifest.trustedEntry.trim()
      ? entry.manifest.trustedEntry.trim()
      : trustedEntryFileName;
    if (!entry.manifest.trustedEntry) {
      entry = {
        ...entry,
        manifest: { ...entry.manifest, trustedEntry },
      };
      await writeJson(entryPath, entry);
      changes.push(`Paired system:full with ${trustedEntry}.`);
    }
    const trustedPath = projectPath(resolve(root, 'src'), trustedEntry, 'manifest.trustedEntry');
    const trustedMissing = await access(trustedPath, fsConstants.R_OK).then(() => false, () => true);
    if (trustedMissing) {
      await mkdir(dirname(trustedPath), { recursive: true });
      await writeFile(trustedPath, trustedRuntimeStarterSource, 'utf8');
      changes.push(`Created ${toSlash(relative(root, trustedPath))}.`);
    }
    if (!isEchoVersionAtLeast(manifest.compatibility?.minEchoVersion, fullTrustMinimumEchoVersion)) {
      manifest = {
        ...manifest,
        compatibility: { ...manifest.compatibility, minEchoVersion: fullTrustMinimumEchoVersion },
      };
      await writeJson(manifestPath, manifest);
      changes.push(`Bumped minEchoVersion to ${fullTrustMinimumEchoVersion}.`);
    }
  }
  const kind = manifest.content.kind;
  const preset = inferKindPreset(kind, entry);
  const restoreDocFile = async (fileName, content, description) => {
    const missing = await access(resolve(root, fileName), fsConstants.R_OK).then(() => false, () => true);
    if (!missing) return;
    await writeFile(resolve(root, fileName), content, 'utf8');
    changes.push(description);
  };
  await restoreDocFile(
    'README.md',
    createProjectReadme(manifest.title, kind, preset, manifest.content.entry),
    'Created a starter README.md (quality expects setup and usage notes).',
  );
  await restoreDocFile('CUSTOMIZE.md', createCustomizeGuide(kind, preset, manifest.id), 'Restored CUSTOMIZE.md.');
  await restoreDocFile('.gitignore', createGitignore(), 'Restored .gitignore for authoring leftovers.');
  const synced = await syncProject(root);
  changes.push(`Synced ${synced.files} content file(s).`);
  return { ...synced, changes };
};

const doctor = async () => {
  const required = [
    'echo-workshop-sdk.json',
    'echo-workshop-plugin.d.ts',
    'echo-workshop-ui-runtime.d.ts',
    'echo-workshop-native-shell.d.ts',
    'echo-workshop-animation-library.d.ts',
    'schemas/echo.workshop.schema.json',
    'schemas/project.schema.json',
    'schemas/plugin-package.schema.json',
    'schemas/theme.schema.json',
    'schemas/lyrics-style.schema.json',
    'schemas/animation-library.schema.json',
    'schemas/visualizer.schema.json',
    'schemas/dsp.schema.json',
    'schemas/locale-pack.schema.json',
    'schemas/native-shell.schema.json',
    'contracts/plugin-api.json',
    'contracts/native-shell.json',
    'contracts/native-shell-limits.json',
    'contracts/content-kinds.json',
    'templates/plugin-basic/plugin.js',
    'templates/plugin-complete/plugin.js',
    'templates/plugin-catalog/plugin.js',
    'templates/plugin-lyrics/plugin.js',
    'templates/github/validate-workshop.yml',
    'lib/project-templates.mjs',
    'lib/content-kind-contract.mjs',
    'lib/theme-assets.mjs',
    'lib/preview-png.mjs',
    'lib/cli-report.mjs',
    'lib/author-guide.mjs',
    'lib/mock-host.mjs',
    'lib/quality-report.mjs',
    'lib/kind-presets.mjs',
    'lib/author-actions.mjs',
    'lib/recipes.mjs',
    'lib/guide.mjs',
    'lib/command-help.mjs',
    'lib/snippets.mjs',
    'lib/watch-utils.mjs',
    'lib/network-policy.mjs',
    'lib/native-shell.mjs',
    'lib/trusted-plugin.mjs',
    'bin/echo-workshop-sdk.cmd',
    'README.zh-CN.md',
    'TROUBLESHOOTING.md',
    'CHEATSHEET.md',
    'CONTRIBUTING.md',
    'GOVERNANCE.md',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
    'examples/retro-modern-ui-runtime/content/ui/app.js',
    'examples/lyrics-cinema-scene/content/lyrics-style.json',
    'examples/visualizer-radial/content/visualizer.json',
    'examples/dsp-vocal/content/dsp.json',
    'examples/locale-wenyan/content/locale.json',
    'examples/hello-plugin/src/plugin.js',
    'examples/minimal-theme/content/theme.json',
    'examples/native-shell-taskbar/content/native-shell.json',
  ];
  for (const path of required) await access(resolve(sdkRoot, ...path.split('/')), fsConstants.R_OK);
  const descriptor = await readJson(resolve(sdkRoot, 'echo-workshop-sdk.json'));
  if (descriptor.sdkVersion !== 1 || descriptor.plugin?.currentApiVersion !== 2) fail('SDK descriptor is inconsistent');
  return { count: required.length, version: descriptor.packageVersion };
};

const versionSurface = async () => {
  const descriptor = await readJson(resolve(sdkRoot, 'echo-workshop-sdk.json'));
  return {
    packageVersion: descriptor.packageVersion,
    sdkVersion: descriptor.sdkVersion,
    manifestSchemaVersions: descriptor.manifest.schemaVersions,
    contentKinds: descriptor.manifest.contentKinds,
    pluginApiVersions: descriptor.plugin.apiVersions,
    currentPluginApiVersion: descriptor.plugin.currentApiVersion,
    uiRuntimeProtocolVersion: descriptor.theme.uiRuntimeProtocolVersion,
    stylesheetMinEchoVersion: descriptor.theme.stylesheetMinEchoVersion,
    animationLibrary: descriptor.animationLibrary,
    pluginPackageLimits: {
      maximumFiles: maximumPluginFiles,
      maximumFileBytes: maximumPluginFileBytes,
      maximumPackageBytes: maximumPluginPackageBytes,
      supportedAssetExtensions: pluginPackageLimits.supportedAssetExtensions,
      externalAssetPrefix,
      maximumExternalAssetFileBytes,
      maximumExternalAssetBytes,
      supportedExternalAssetExtensions: pluginPackageLimits.supportedExternalAssetExtensions,
    },
    nativeShellLimits: {
      maximumFiles: maximumNativeShellFiles,
      maximumFileBytes: maximumNativeShellFileBytes,
      maximumPackageBytes: maximumNativeShellPackageBytes,
      supportedAssetExtensions: nativeShellLimits.supportedAssetExtensions,
    },
    kinds: workshopTemplateKinds.map((kind) => ({
      kind,
      entry: templateEntryForKind(kind),
      tag: templateTagForKind(kind),
      defaultPreset: defaultPresetForKind(kind),
    })),
    recipes: workshopRecipes.map((recipe) => recipe.id),
    guideTopics,
    snippets: snippetNames,
    contracts: ['contracts/plugin-api.json', 'contracts/plugin-package-limits.json', 'contracts/native-shell.json', 'contracts/native-shell-limits.json', 'contracts/content-kinds.json'],
  };
};

const formatVersionSurface = (surface) => [
  `ECHO Workshop SDK ${surface.packageVersion} (sdkVersion ${surface.sdkVersion})`,
  `Manifest schema: ${surface.manifestSchemaVersions.join(', ')} · plugin API: ${surface.pluginApiVersions.join(', ')} (current ${surface.currentPluginApiVersion})`,
  `UI runtime protocol: ${surface.uiRuntimeProtocolVersion} · stylesheet/runtime min ECHO: ${surface.stylesheetMinEchoVersion}`,
  `Animation library schema: ${surface.animationLibrary.schemaVersion} · min ECHO: ${surface.animationLibrary.minimumEchoVersion} · ${surface.animationLibrary.properties.length} bounded properties · ${surface.animationLibrary.clipDirections.length} reveals · ${surface.animationLibrary.staggerOrigins.length} stagger orders`,
  `Content kinds: ${surface.contentKinds.join(', ')}`,
  `Plug-in limits: ${surface.pluginPackageLimits.maximumFiles} files · ${surface.pluginPackageLimits.maximumFileBytes} B/file · ${surface.pluginPackageLimits.maximumPackageBytes} B/package`,
  `Native-shell limits: ${surface.nativeShellLimits.maximumFiles} files · ${surface.nativeShellLimits.maximumFileBytes} B/file · ${surface.nativeShellLimits.maximumPackageBytes} B/package`,
  `Recipes: ${surface.recipes.length} · guide topics: ${surface.guideTopics.length} · snippets: ${surface.snippets.length} (per-kind entries/tags via --json)`,
  `Machine-readable contracts: ${surface.contracts.join(', ')}`,
].join('\n');

const kindsCatalog = () => ({
  kinds: workshopTemplateKinds.map((kind) => ({
    kind,
    entry: templateEntryForKind(kind),
    tag: templateTagForKind(kind),
    defaultPreset: defaultPresetForKind(kind),
  })),
  presets: {
    theme: themePresets,
    'lyrics-style': lyricsStylePresets,
    'visualizer-preset': visualizerPresets,
    'dsp-preset': dspPresets,
    'plugin-package': pluginPresets,
  },
});

const runItemTests = async (result) => testWorkshopItem({
  kind: result.manifest.content.kind,
  contentRoot: result.contentRoot,
  manifest: result.manifest,
  entry: result.entry,
});

const printJsonOrText = (options, value, text) => {
  console.log(options.get('json') === 'true' ? JSON.stringify(value, null, 2) : text);
};

const inspectPublicApi = (query) => {
  if (query === 'errors') {
    return { kind: 'errors', errors: pluginApiContract.commonErrors };
  }
  const normalized = String(query ?? '').trim().toLowerCase();
  const actions = Object.entries(pluginApiContract.actions)
    .map(([action, contract]) => ({ action, ...contract }))
    .filter((entry) => !normalized
      || entry.action.toLowerCase().includes(normalized)
      || entry.method.toLowerCase().includes(normalized)
      || String(entry.permission ?? 'none').toLowerCase().includes(normalized));
  const registrations = Object.entries(pluginApiContract.registrations)
    .map(([method, contract]) => ({ method, ...contract }))
    .filter((entry) => !normalized
      || entry.method.toLowerCase().includes(normalized)
      || String(entry.permission ?? 'none').toLowerCase().includes(normalized));
  if (normalized && actions.length === 0 && registrations.length === 0) {
    fail(`Unknown public API query ${query}`);
  }
  return { kind: 'methods', apiVersion: pluginApiContract.apiVersion, actions, registrations };
};

const formatPublicApi = (result) => {
  if (result.kind === 'errors') {
    return Object.entries(result.errors).map(([code, contract]) => [
      code,
      contract.retry ? 'retry with backoff' : 'do not auto-retry',
      contract.recovery,
    ].join('  ·  ')).join('\n');
  }
  return [
    ...result.actions.map((entry) => `${entry.method.padEnd(42)} ${(entry.permission ?? '(none)').padEnd(18)} ${entry.action}`),
    ...result.registrations.map((entry) => `${entry.method.padEnd(42)} ${(entry.permission ?? '(none)').padEnd(18)} declare ${entry.declaration}`),
  ].join('\n');
};

const main = async () => {
  const { positional, options } = parseArguments(process.argv.slice(2));
  const [rawCommand, directory] = positional;
  const command = rawCommand === 'new' ? 'init' : rawCommand;
  if (!command || command === 'help') { console.log(directory ? formatCommandHelp(directory) : usage); return; }
  if (options.get('help') === 'true') { console.log(formatCommandHelp(command)); return; }
  if (command === 'guide') {
    console.log(directory === 'list' ? formatGuideTopics() : formatGuide(!directory ? null : directory));
    return;
  }
  if (command === 'api') {
    const result = inspectPublicApi(directory);
    printJsonOrText(options, result, formatPublicApi(result));
    return;
  }
  if (command === 'recipes') {
    printJsonOrText(
      options,
      workshopRecipes,
      workshopRecipes.map((item) => `${item.id.padEnd(20)} ${item.kind}/${item.preset}  ${item.summary}`).join('\n'),
    );
    return;
  }
  if (command === 'snippet') {
    if (!directory || directory === 'list') {
      printJsonOrText(options, workshopSnippets.map(({ code, ...meta }) => meta), formatSnippetList());
      return;
    }
    const snippet = findSnippet(directory);
    printJsonOrText(options, snippet, formatSnippet(snippet));
    return;
  }
  if (command === 'doctor') {
    const ready = await doctor();
    printJsonOrText(
      options,
      { ok: true, packageVersion: ready.version, checkedAssets: ready.count },
      `[echo-workshop-sdk] ${ready.version} ready: ${ready.count} portable assets checked.`,
    );
    return;
  }
  if (command === 'version') {
    const surface = await versionSurface();
    printJsonOrText(options, surface, formatVersionSurface(surface));
    return;
  }
  if (command === 'kinds') {
    printJsonOrText(options, kindsCatalog(), formatKinds(kindsCatalog()));
    return;
  }
  if (command === 'example') {
    if (!directory || directory === 'list') {
      printJsonOrText(
        options,
        officialExampleProjects,
        officialExampleProjects.map((item) => `${item.name}  ${item.kind}/${item.preset}  ${item.summary}`).join('\n'),
      );
      return;
    }
    const destination = positional[2];
    if (!destination) fail('Missing destination directory.\nHint: example stylesheet-theme .\\my-theme');
    const copied = await copyOfficialExample(directory, destination);
    console.log(`[echo-workshop-sdk] Copied ${copied.name} to ${copied.root}.`);
    return;
  }
  if (!directory) fail(`Missing project directory.\n\n${usage}`);
  if (command === 'init') {
    const result = await initProject(directory, options);
    console.log(formatNextSteps(result, result.kind, result.preset));
    return;
  }
  if (command === 'sync') {
    const result = await syncProject(directory);
    console.log(`[echo-workshop-sdk] Synced ${result.id}: ${result.files} content file(s).`);
    return;
  }
  if (command === 'validate') {
    const result = await validateProject(directory);
    const inspection = inspectProject(result.project, result.manifest, result.entry);
    printJsonOrText(
      options,
      { ok: true, id: result.id, kind: result.manifest.content.kind, files: result.files, minEchoVersion: result.manifest.compatibility.minEchoVersion, inspection },
      `[echo-workshop-sdk] Valid ${result.id} · ${result.manifest.content.kind}${inspection.customization?.preset ? ` / ${inspection.customization.preset}` : ''} · ${result.files} file(s) · min ECHO ${result.manifest.compatibility.minEchoVersion}`,
    );
    return;
  }
  if (command === 'check') {
    const warnOnly = options.get('warn-only') === 'true';
    const result = await syncProject(directory);
    const quality = await buildQualityReport(result.root, result.project, result.manifest, result.entry);
    const tests = await runItemTests(result);
    const fixtureChecks = tests.checks ?? [];
    const report = {
      ok: quality.ok && tests.ok,
      warnOnly,
      id: result.id,
      title: result.manifest.title,
      kind: result.manifest.content.kind,
      version: result.manifest.version,
      minEchoVersion: result.manifest.compatibility?.minEchoVersion ?? null,
      files: result.files,
      permissions: result.entry?.manifest?.permissions ?? result.entry?.runtime?.capabilities ?? [],
      gate: {
        qualityPass: quality.summary.pass,
        qualityWarnings: quality.summary.warning,
        qualityBlockers: quality.summary.blocker,
        fixturesPassed: fixtureChecks.filter((check) => check.ok).length,
        fixturesTotal: fixtureChecks.length,
      },
      quality,
      tests,
    };
    printJsonOrText(options, report, [
      `[echo-workshop-sdk] Valid ${result.id} · ${result.manifest.content.kind} · ${result.files} file(s).`,
      formatQualityReport(quality),
      formatTestReport(tests),
      formatGateSummary(report),
      !report.ok && warnOnly ? '[echo-workshop-sdk] warn-only: reporting failures without a failing exit code. Publication still requires a clean check.' : '',
    ].filter(Boolean).join('\n'));
    if (!report.ok && !warnOnly) process.exitCode = 1;
    return;
  }
  if (command === 'inspect') {
    const result = await validateProject(directory);
    console.log(JSON.stringify(inspectProject(result.project, result.manifest, result.entry), null, 2));
    return;
  }
  if (command === 'explain') {
    const result = await validateProject(directory);
    const inspection = inspectProject(result.project, result.manifest, result.entry);
    printJsonOrText(options, inspection, formatExplain(inspection));
    return;
  }
  if (command === 'add') {
    const result = await addToProject(directory, options, positional);
    console.log(`[echo-workshop-sdk] ${result.change}. Synced ${result.files} file(s).`);
    return;
  }
  if (command === 'set') {
    const result = await setProjectFields(directory, options);
    console.log(`[echo-workshop-sdk] Updated ${result.id}.`);
    return;
  }
  if (command === 'next') {
    const result = await validateProject(directory);
    const moves = describeNextMoves(result.manifest.content.kind, result.entry);
    const quality = await buildQualityReport(result.root, result.project, result.manifest, result.entry);
    const attention = attentionFromQuality(quality);
    printJsonOrText(
      options,
      { id: result.id, kind: result.manifest.content.kind, attention, moves },
      formatNextMoves(moves, attention),
    );
    return;
  }
  if (command === 'watch') {
    await watchProject(directory);
    return;
  }
  if (command === 'scaffold') {
    const result = await scaffoldProject(directory, options);
    console.log(`[echo-workshop-sdk] Scaffolded ${result.id}: ${result.files} content file(s).`);
    return;
  }
  if (command === 'fix') {
    const result = await fixProject(directory);
    console.log(`[echo-workshop-sdk] Fixed ${result.id}.\n${result.changes.map((change) => `  - ${change}`).join('\n')}`);
    return;
  }
  if (command === 'upgrade') {
    const result = await upgradeProject(directory);
    console.log(`[echo-workshop-sdk] Upgraded portable tools to ${result.current}${result.previous ? ` (was ${result.previous})` : ''}.`);
    return;
  }
  if (command === 'quality') {
    const result = await syncProject(directory);
    const report = await buildQualityReport(result.root, result.project, result.manifest, result.entry);
    printJsonOrText(options, report, formatQualityReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'test') {
    const result = await syncProject(directory);
    const report = await runItemTests(result);
    printJsonOrText(options, report, formatTestReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'dev') {
    const first = await syncProject(directory);
    const port = Number(options.get('port') ?? 41783);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('--port must be between 1024 and 65535');
    const watchPath = first.manifest.content.kind === 'plugin-package' ? 'src' : first.project.contentDirectory;
    const host = await startMockHost({
      root: first.root,
      port,
      portIsExplicit: options.has('port'),
      runTests: async () => {
        const result = await syncProject(directory);
        const tests = await runItemTests(result);
        const quality = await buildQualityReport(result.root, result.project, result.manifest, result.entry);
        return {
          ok: tests.ok && quality.ok,
          id: result.id,
          title: result.manifest.title,
          kind: result.manifest.content.kind,
          version: result.manifest.version,
          minEchoVersion: result.manifest.compatibility?.minEchoVersion ?? null,
          files: result.files,
          permissions: result.entry?.manifest?.permissions ?? result.entry?.runtime?.capabilities ?? [],
          entry: result.entry,
          tests,
          quality,
        };
      },
      watchPath,
      contentRoot: first.contentRoot,
      kind: first.manifest.content.kind,
      stylesheet: first.entry.stylesheet ?? null,
      runtimeEntry: first.entry.runtime?.entry ?? null,
      packId: first.id,
      entry: first.entry,
    });
    if (host.port !== host.requestedPort) {
      console.log(`[echo-workshop-sdk] Port ${host.requestedPort} was busy; using ${host.port} instead.`);
    }
    console.log(`[echo-workshop-sdk] Author console ready at ${host.consoleUrl}. Watching ${watchPath}.`);
    if (host.previewUrl) console.log(`[echo-workshop-sdk] Content preview at ${host.previewUrl}.`);
    return;
  }
  fail(`Unknown command: ${command}\n\n${usage}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[echo-workshop-sdk] ${message}`);
  const hint = hintForError(message);
  if (hint) console.error(hint);
  process.exitCode = 1;
});
