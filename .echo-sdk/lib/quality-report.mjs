import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  collectLyricsSceneSlots,
  eqFilterTypes,
  eqFrequenciesHz,
  isHexColor,
  lyricsBackgroundModes,
  lyricsPageStyles,
  lyricsSceneBackgrounds,
  lyricsSceneSlots,
  visualizerStyles,
} from './kind-presets.mjs';
import {
  forbiddenThemeBasePresets,
  isEchoVersionAtLeast,
  stylesheetMinEchoVersion,
  themeUiCapabilities,
} from './theme-assets.mjs';
import { isSteamworksConfiguredTag, steamworksConfiguredTags } from './content-kind-contract.mjs';
import { nativeShellExePattern, nativeShellPermissions } from './native-shell.mjs';
import { animationLibraryMinEchoVersion } from './animation-preview.mjs';

const lyricsSlotSet = new Set(lyricsSceneSlots);
const officialEqFrequencies = eqFrequenciesHz.join(',');

const readImageDimensions = (buffer, extension) => {
  if (extension === '.png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (extension === '.gif' && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
};

const issue = (code, severity, message) => ({ code, severity, message });
const containsPlaceholder = (value) => /radio\.example|replace with|workshop author|my echo|todo|00000000000000000000000000000000/iu.test(value);
const isSafeRelativeCss = (value) => /^(?!\/|\\|\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.css$/u.test(value);
const isSafeRelativeHtml = (value) => /^(?!\/|\\|\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.html$/u.test(value);

const addThemeIssues = (issues, manifest, entry) => {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const listed = (path) => files.some((file) => file?.path === path);
  if (forbiddenThemeBasePresets.includes(entry.basePreset)) {
    issues.push(issue('theme-base-preset', 'blocker', `${entry.basePreset} is a host-owned preset and cannot be used as basePreset.`));
  } else {
    issues.push(issue('theme-base-preset', 'pass', `basePreset is ${entry.basePreset || 'classic'}.`));
  }

  const stylesheet = typeof entry.stylesheet === 'string' ? entry.stylesheet.trim() : '';
  if (stylesheet) {
    if (!isSafeRelativeCss(stylesheet)) {
      issues.push(issue('theme-stylesheet', 'blocker', 'stylesheet must be a packaged relative .css path.'));
    } else if (files.length > 0 && !listed(stylesheet)) {
      issues.push(issue('theme-stylesheet', 'warning', `${stylesheet} is declared but not yet in the file inventory. Run sync.`));
    } else {
      issues.push(issue('theme-stylesheet', 'pass', `${stylesheet} is declared. The host sanitizes it and does not unlock a built-in host pack.`));
    }
    const minEchoVersion = manifest.compatibility?.minEchoVersion;
    issues.push(isEchoVersionAtLeast(minEchoVersion, stylesheetMinEchoVersion)
      ? issue('theme-stylesheet-min-echo', 'pass', `Minimum ECHO version ${minEchoVersion} supports packaged stylesheets.`)
      : issue('theme-stylesheet-min-echo', 'warning', `Stylesheet themes should declare minEchoVersion ${stylesheetMinEchoVersion} or newer so older clients fail closed on version instead of unknown fields.`));
  }

  const runtime = entry.runtime && typeof entry.runtime === 'object' ? entry.runtime : null;
  if (runtime) {
    const runtimeEntry = typeof runtime.entry === 'string' ? runtime.entry.trim() : '';
    const capabilities = Array.isArray(runtime.capabilities) ? runtime.capabilities : [];
    if (!isSafeRelativeHtml(runtimeEntry)) {
      issues.push(issue('theme-runtime', 'blocker', 'runtime.entry must be a packaged relative .html path.'));
    } else if (files.length > 0 && !listed(runtimeEntry)) {
      issues.push(issue('theme-runtime', 'warning', `${runtimeEntry} is declared but not yet in the file inventory. Run sync.`));
    } else {
      issues.push(issue('theme-runtime', 'pass', `UI runtime entry ${runtimeEntry} is declared.`));
    }
    const allowed = new Set(themeUiCapabilities);
    issues.push(capabilities.length > 0 && capabilities.every((capability) => allowed.has(capability)) && new Set(capabilities).size === capabilities.length
      ? issue('theme-runtime-capabilities', 'pass', `${capabilities.length} UI runtime capability(ies) declared.`)
      : issue('theme-runtime-capabilities', 'blocker', 'runtime.capabilities must be a unique subset of the host UI bridge whitelist.'));
    issues.push(isEchoVersionAtLeast(manifest.compatibility?.minEchoVersion, stylesheetMinEchoVersion)
      ? issue('theme-runtime-min-echo', 'pass', `Minimum ECHO version ${manifest.compatibility.minEchoVersion} supports the UI runtime.`)
      : issue('theme-runtime-min-echo', 'warning', `UI runtime themes should declare minEchoVersion ${stylesheetMinEchoVersion} or newer.`));
  }

  if (entry.skin && typeof entry.skin === 'object') {
    const assets = entry.skin.assets && typeof entry.skin.assets === 'object' ? Object.values(entry.skin.assets) : [];
    const missing = assets.filter((path) => typeof path === 'string' && path && !listed(path));
    issues.push(missing.length === 0
      ? issue('theme-skin', 'pass', entry.stylesheet
        ? 'Skin is present as a fallback description; a packaged stylesheet wins at runtime.'
        : 'Declarative skin fields are present.')
      : issue('theme-skin', 'warning', `Skin assets missing from the file inventory: ${missing.join(', ')}.`));
  }
};

const addPluginIssues = (issues, manifest, entry) => {
  const pluginManifest = entry?.manifest && typeof entry.manifest === 'object' ? entry.manifest : {};
  const permissions = Array.isArray(pluginManifest.permissions) ? pluginManifest.permissions : [];
  const hosts = Array.isArray(manifest.networkHosts) ? manifest.networkHosts : [];
  issues.push(permissions.includes('network:request') && hosts.length === 0
    ? issue('network-hosts', 'blocker', 'network:request requires fixed networkHosts on the outer manifest.')
    : issue('network-hosts', 'pass', 'Network permission and host declarations are consistent.'));
  const trustedEntry = typeof pluginManifest.trustedEntry === 'string' ? pluginManifest.trustedEntry.trim() : '';
  const requestsFullSystem = permissions.includes('system:full');
  issues.push(requestsFullSystem === Boolean(trustedEntry)
    ? issue('trusted-runtime', 'pass', requestsFullSystem
      ? `Full-system capability is paired with trustedEntry ${trustedEntry}.`
      : 'No full-system runtime requested.')
    : issue('trusted-runtime', 'blocker', requestsFullSystem
      ? 'system:full requires manifest.trustedEntry pointing to a packaged .mjs module.'
      : 'manifest.trustedEntry requires the system:full capability.'));
};

const addLyricsIssues = (issues, entry) => {
  const settings = entry?.settings && typeof entry.settings === 'object' ? entry.settings : {};
  const scene = entry?.scene && typeof entry.scene === 'object' ? entry.scene : null;
  if (!scene && Object.keys(settings).length === 0) {
    issues.push(issue('lyrics-empty', 'blocker', 'A lyrics style must declare settings, a scene, or both.'));
    return;
  }
  if (settings.lyricsPageStyle) {
    issues.push(lyricsPageStyles.includes(settings.lyricsPageStyle)
      ? issue('lyrics-page-style', 'pass', `lyricsPageStyle is ${settings.lyricsPageStyle}.`)
      : issue('lyrics-page-style', 'blocker', `lyricsPageStyle must be one of ${lyricsPageStyles.join(', ')}.`));
  }
  if (settings.lyricsBackgroundMode) {
    issues.push(lyricsBackgroundModes.includes(settings.lyricsBackgroundMode)
      ? issue('lyrics-background-mode', 'pass', `lyricsBackgroundMode is ${settings.lyricsBackgroundMode}.`)
      : issue('lyrics-background-mode', 'blocker', 'lyricsBackgroundMode must be theme, cover or coverColor.'));
  }
  if (!scene) {
    issues.push(issue('lyrics-scene', 'warning', 'Settings-only lyrics styles keep the host layout. Add a scene to replace the page.'));
    return;
  }
  issues.push(lyricsSceneBackgrounds.includes(scene.background)
    ? issue('lyrics-scene-background', 'pass', `Scene background is ${scene.background}.`)
    : issue('lyrics-scene-background', 'blocker', `Scene background must be one of ${lyricsSceneBackgrounds.join(', ')}.`));
  const slots = collectLyricsSceneSlots(scene.root);
  const unknown = slots.filter((slot) => !lyricsSlotSet.has(slot));
  issues.push(unknown.length === 0
    ? issue('lyrics-slots', 'pass', `${slots.length} host-owned slot(s) declared.`)
    : issue('lyrics-slots', 'blocker', `Unknown lyrics slots: ${unknown.join(', ')}.`));
  issues.push(slots.includes('lyrics') || slots.includes('current-line')
    ? issue('lyrics-slot-required', 'pass', 'The scene declares a lyrics or current-line slot.')
    : issue('lyrics-slot-required', 'blocker', 'A lyrics scene must include a lyrics or current-line slot.'));
  issues.push(scene.hostChrome?.miniPlayer !== 'hidden' || slots.includes('play-toggle')
    ? issue('lyrics-transport', 'pass', 'Host chrome and play-toggle stay consistent.')
    : issue('lyrics-transport', 'blocker', 'Hiding the host mini player requires a play-toggle slot.'));
};

const addVisualizerIssues = (issues, entry) => {
  issues.push(visualizerStyles.includes(entry?.style)
    ? issue('visualizer-style', 'pass', `Visualizer style is ${entry.style}.`)
    : issue('visualizer-style', 'blocker', 'style must be bars, wave or radial. particles is not a host style.'));
  const palette = Array.isArray(entry?.palette) ? entry.palette : [];
  const unique = new Set(palette.map((value) => String(value).toLowerCase()));
  issues.push(palette.length >= 1 && palette.length <= 8 && unique.size === palette.length && palette.every(isHexColor)
    ? issue('visualizer-palette', 'pass', `${palette.length} unique hex color(s).`)
    : issue('visualizer-palette', 'blocker', 'palette must be 1-8 unique #rrggbb colors.'));
  const inRange = (value, minimum, maximum) => typeof value === 'number' && value >= minimum && value <= maximum;
  issues.push(Number.isInteger(entry?.barCount) && inRange(entry.barCount, 8, 128)
    ? issue('visualizer-bar-count', 'pass', `barCount is ${entry.barCount}.`)
    : issue('visualizer-bar-count', 'blocker', 'barCount must be an integer from 8 to 128.'));
  issues.push(inRange(entry?.smoothing, 0, 1) && inRange(entry?.sensitivity, 0.25, 4) && inRange(entry?.decay, 0, 1)
    ? issue('visualizer-motion', 'pass', 'smoothing, sensitivity and decay are in host ranges.')
    : issue('visualizer-motion', 'blocker', 'smoothing 0-1, sensitivity 0.25-4, decay 0-1.'));
};

const addDspIssues = (issues, entry) => {
  const bands = Array.isArray(entry?.bands) ? entry.bands : [];
  issues.push(bands.length === eqFrequenciesHz.length
    ? issue('dsp-band-count', 'pass', `EQ has the host ${eqFrequenciesHz.length}-band layout.`)
    : issue('dsp-band-count', 'blocker', `DSP presets must declare exactly ${eqFrequenciesHz.length} bands.`));
  const frequencies = bands.map((band) => band?.frequencyHz).join(',');
  issues.push(frequencies === officialEqFrequencies
    ? issue('dsp-frequencies', 'pass', 'Band frequencies match the ECHO 31-band set.')
    : issue('dsp-frequencies', 'warning', 'Use the official 31 ISO frequencies so the host EQ UI lines up.'));
  const invalid = bands.find((band) => {
    const gain = band?.gainDb;
    const q = band?.q;
    const filter = band?.filterType ?? 'peaking';
    return typeof gain !== 'number' || gain < -12 || gain > 12
      || typeof q !== 'number' || q < 0.1 || q > 12
      || !eqFilterTypes.includes(filter);
  });
  issues.push(!invalid
    ? issue('dsp-bands', 'pass', 'Band gain, Q and filter types stay in host ranges.')
    : issue('dsp-bands', 'blocker', 'Each band needs gain -12..12, Q 0.1..12 and a host filter type.'));
  issues.push(typeof entry?.preampDb === 'number' && entry.preampDb >= -12 && entry.preampDb <= 6
    ? issue('dsp-preamp', 'pass', `preampDb is ${entry.preampDb}.`)
    : issue('dsp-preamp', 'blocker', 'preampDb must be between -12 and 6.'));
  if (entry?.audioEffect !== undefined) {
    const effect = entry.audioEffect;
    const commonValid = effect && (effect.type === 'bitcrusher' || effect.type === 'chiptune')
      && Number.isInteger(effect.bitDepth) && effect.bitDepth >= 4 && effect.bitDepth <= 16
      && Number.isInteger(effect.sampleRateHz) && effect.sampleRateHz >= 1000 && effect.sampleRateHz <= 192000
      && typeof effect.mix === 'number' && effect.mix >= 0 && effect.mix <= 1
      && (effect.outputGainDb === undefined
        || (typeof effect.outputGainDb === 'number' && effect.outputGainDb >= -24 && effect.outputGainDb <= 6));
    const chiptuneValid = effect?.type !== 'chiptune' || (
      typeof effect.pulseMix === 'number' && effect.pulseMix >= 0 && effect.pulseMix <= 1
      && typeof effect.triangleMix === 'number' && effect.triangleMix >= 0 && effect.triangleMix <= 1
      && typeof effect.noiseMix === 'number' && effect.noiseMix >= 0 && effect.noiseMix <= 1
      && effect.pulseMix + effect.triangleMix + effect.noiseMix > 0
      && typeof effect.drive === 'number' && effect.drive >= 1 && effect.drive <= 8
    );
    const valid = commonValid && chiptuneValid;
    issues.push(valid
      ? issue('dsp-audio-effect', 'pass', `Bounded ${effect.type} audio processing is declared.`)
      : issue('dsp-audio-effect', 'blocker', 'audioEffect must be a bounded bitcrusher or chiptune configuration.'));
  }
};

const builtinLocales = new Set(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR']);
const localeCodePattern = /^[a-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/u;

const addLocalePackIssues = (issues, entry) => {
  issues.push(entry?.type === 'echo-workshop-locale-pack'
    ? issue('locale-header', 'pass', 'locale.json uses echo-workshop-locale-pack.')
    : issue('locale-header', 'blocker', 'locale.json must use type echo-workshop-locale-pack.'));
  const locale = typeof entry?.locale === 'string' ? entry.locale : '';
  issues.push(localeCodePattern.test(locale) && !builtinLocales.has(locale)
    ? issue('locale-code', 'pass', `Locale code is ${locale}.`)
    : issue('locale-code', 'blocker', 'locale must be a BCP-47 code that is not one of ECHO\'s five built-in languages.'));
  const strings = entry?.strings && typeof entry.strings === 'object' && !Array.isArray(entry.strings)
    ? entry.strings
    : null;
  const count = strings ? Object.keys(strings).length : 0;
  issues.push(count >= 1 && count <= 8192
    ? issue('locale-strings', 'pass', `${count} translated keys. Missing keys fall back to the built-in locale.`)
    : issue('locale-strings', 'blocker', 'strings must contain 1-8192 non-empty translation keys.'));
};

const addNativeShellIssues = async (issues, root, project, entry) => {
  issues.push(entry?.type === 'echo-workshop-native-shell' && entry?.protocolVersion === 1
    ? issue('native-shell-protocol', 'pass', 'native-shell protocol v1 is declared.')
    : issue('native-shell-protocol', 'blocker', 'native-shell.json must use type echo-workshop-native-shell and protocolVersion 1.'));
  const permissions = Array.isArray(entry?.permissions) ? entry.permissions : [];
  const unknown = permissions.filter((item) => !nativeShellPermissions.includes(item));
  issues.push(permissions.length > 0 && unknown.length === 0
    ? issue('native-shell-permissions', 'pass', `${permissions.length} native-shell permission(s) declared.`)
    : issue('native-shell-permissions', 'blocker', 'permissions must be taken from contracts/native-shell.json.'));
  issues.push(typeof entry?.exe === 'string' && nativeShellExePattern.test(entry.exe)
    ? issue('native-shell-exe-path', 'pass', `Host exe path is ${entry.exe}.`)
    : issue('native-shell-exe-path', 'blocker', 'exe must be a relative .exe path.'));
  if (typeof entry?.exe === 'string') {
    try {
      await readFile(resolve(root, project.contentDirectory, entry.exe));
      issues.push(issue('native-shell-exe', 'pass', 'Packaged host executable is present.'));
    } catch {
      issues.push(issue('native-shell-exe', 'warning', 'Host exe is absent. Authoring check still passes; a live host needs the file.'));
    }
  }
};

export const buildQualityReport = async (root, project, manifest, entry) => {
  const issues = [];
  const previewPath = resolve(root, project.previewFile);
  const preview = await readFile(previewPath);
  const dimensions = readImageDimensions(preview, extname(previewPath).toLowerCase());
  if (!dimensions) issues.push(issue('preview-readable', 'blocker', 'Preview image dimensions could not be read.'));
  else {
    issues.push(dimensions.width >= 195 && dimensions.height >= 195
      ? issue('preview-size', 'pass', `Preview is ${dimensions.width} x ${dimensions.height}.`)
      : issue('preview-size', 'blocker', `Preview is ${dimensions.width} x ${dimensions.height}; Steam guides and listings need at least 195 x 195.`));
    issues.push(Math.abs(dimensions.width - dimensions.height) <= Math.max(4, dimensions.width * 0.05)
      ? issue('preview-square', 'pass', 'Preview aspect ratio is suitable for Workshop discovery.')
      : issue('preview-square', 'warning', 'A square preview is recommended for consistent Workshop discovery.'));
  }
  issues.push(project.description.trim().length >= 80
    ? issue('description', 'pass', 'Listing description has enough context.')
    : issue('description', 'warning', 'Expand the listing description to at least 80 characters.'));
  issues.push(project.changeNote.trim().length >= 12
    ? issue('change-note', 'pass', 'A meaningful change note is present.')
    : issue('change-note', 'warning', 'Explain what changed before updating the item.'));
  const unconfiguredTags = Array.isArray(project.tags)
    ? project.tags.filter((tag) => !isSteamworksConfiguredTag(tag))
    : [];
  issues.push(Array.isArray(project.tags) && project.tags.length > 0
    ? (unconfiguredTags.length === 0
      ? issue('tags', 'pass', `${project.tags.length} Workshop tag(s) declared.`)
      : issue('tags', 'warning', `Not configured for the ECHO AppID and dropped by Steam: ${unconfiguredTags.join(', ')}. Configured tags: ${steamworksConfiguredTags.join(', ')}.`))
    : issue('tags', 'blocker', 'At least one Workshop tag is required.'));
  issues.push(typeof manifest.compatibility?.minEchoVersion === 'string'
    ? issue('compatibility', 'pass', `Minimum ECHO version is ${manifest.compatibility.minEchoVersion}.`)
    : issue('compatibility', 'blocker', 'compatibility.minEchoVersion is missing.'));
  const serialized = JSON.stringify({ manifest, entry, project });
  issues.push(containsPlaceholder(serialized)
    ? issue('placeholders', manifest.content.kind === 'audio-plugin-profile' ? 'blocker' : 'warning', 'Template placeholders remain in the project.')
    : issue('placeholders', 'pass', 'Common template placeholders were not found.'));
  try {
    const readme = await readFile(resolve(root, 'README.md'), 'utf8');
    issues.push(readme.trim().length >= 80
      ? issue('documentation', 'pass', 'Project README is present.')
      : issue('documentation', 'warning', 'Expand README.md with setup and usage instructions.'));
  } catch {
    issues.push(issue('documentation', 'warning', 'Add README.md with setup, capabilities and support notes.'));
  }
  if (manifest.content.kind === 'theme') addThemeIssues(issues, manifest, entry);
  if (manifest.content.kind === 'plugin-package') addPluginIssues(issues, manifest, entry);
  if (manifest.content.kind === 'lyrics-style') addLyricsIssues(issues, entry);
  if (manifest.content.kind === 'animation-library') {
    const animations = Array.isArray(entry?.animations) ? entry.animations : [];
    issues.push(animations.length >= 1 && animations.length <= 64
      ? issue('animation-exports', 'pass', `${animations.length} bounded animation export(s) declared.`)
      : issue('animation-exports', 'blocker', 'Animation libraries require 1-64 bounded exports.'));
    issues.push(isEchoVersionAtLeast(manifest.compatibility?.minEchoVersion, animationLibraryMinEchoVersion)
      ? issue('animation-library-min-echo', 'pass', `Minimum ECHO version ${manifest.compatibility.minEchoVersion} supports animation-library packages.`)
      : issue('animation-library-min-echo', 'blocker', `Animation libraries require minEchoVersion ${animationLibraryMinEchoVersion} or newer.`));
  }
  if (manifest.content.kind === 'visualizer-preset') addVisualizerIssues(issues, entry);
  if (manifest.content.kind === 'dsp-preset') addDspIssues(issues, entry);
  if (manifest.content.kind === 'locale-pack') addLocalePackIssues(issues, entry);
  if (manifest.content.kind === 'native-shell') await addNativeShellIssues(issues, root, project, entry);
  return {
    ok: !issues.some((entryIssue) => entryIssue.severity === 'blocker'),
    summary: {
      pass: issues.filter((entryIssue) => entryIssue.severity === 'pass').length,
      warning: issues.filter((entryIssue) => entryIssue.severity === 'warning').length,
      blocker: issues.filter((entryIssue) => entryIssue.severity === 'blocker').length,
    },
    issues,
  };
};
