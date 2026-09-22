import {
  createDspEntry,
  createLyricsStyleEntry,
  createVisualizerEntry,
  describeDspCustomization,
  describeLyricsCustomization,
  describeVisualizerCustomization,
} from './kind-presets.mjs';
import {
  createThemeEntry,
  createThemeExtraFiles,
  defaultPresetForKind,
  describeThemeCustomization,
  inferThemePreset,
  resolveTemplatePreset,
} from './theme-assets.mjs';
import { inferKindPreset } from './author-actions.mjs';
import { contentKinds, entryFileForKind, steamTagForKind } from './content-kind-contract.mjs';
import { createNativeShellEntry, createNativeShellExtraFiles } from './native-shell.mjs';
import {
  createFullTrustPluginEntry,
  fullTrustPluginPreset,
} from './trusted-plugin.mjs';

export const workshopTemplateKinds = [...contentKinds];

export const templateEntryForKind = (kind) => entryFileForKind(kind);
export const templateTagForKind = (kind) => steamTagForKind(kind);
export {
  defaultPresetForKind,
  describeThemeCustomization,
  inferThemePreset,
  resolveTemplatePreset,
};

const createCatalogPluginEntry = (id, title) => ({
  type: 'echo-plugin-package',
  version: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    id,
    name: title,
    version: '1.0.0',
    apiVersion: 2,
    entry: 'plugin.js',
    permissions: [
      'sources:provide',
      'sources:direct',
      'fs:plugin',
    ],
    contributes: {
      panels: [{ id: 'catalog', title, path: 'panel.html', placement: 'main' }],
      sourceProviders: [{
        id: 'packaged-catalog',
        title: 'Packaged catalog',
        description: 'Browse, search and resolve an author-owned direct-stream catalog. ECHO does not ship a streaming platform.',
      }],
      settings: [
        {
          id: 'show-live-badge',
          title: 'Show live items first in my notes',
          type: 'boolean',
          defaultValue: true,
        },
      ],
    },
  },
  files: [],
});

const createCompletePluginEntry = (id, title) => ({
  type: 'echo-plugin-package',
  version: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    id,
    name: title,
    version: '1.0.0',
    apiVersion: 2,
    entry: 'plugin.js',
    permissions: [
      'playback:read',
      'library:read',
      'sources:provide',
      'sources:direct',
      'agent:runtime',
      'lyrics:provide',
      'fs:plugin',
    ],
    contributes: {
      commands: [
        { id: 'library-summary', title: 'Library summary' },
        { id: 'inspect-track', title: 'Inspect track' },
        {
          id: 'save-library-note',
          title: 'Save a custom library note',
          description: 'Collect structured input in a host-owned form, compose another command and persist the result in sandbox storage.',
          confirm: 'This writes only to this plug-in\'s bounded sandbox storage.',
          parameters: [
            { id: 'name', title: 'Note name', type: 'string', placeholder: 'morning-library', required: true },
            {
              id: 'style',
              title: 'Summary style',
              type: 'select',
              defaultValue: 'brief',
              required: true,
              options: [
                { label: 'Brief', value: 'brief' },
                { label: 'Detailed', value: 'detailed' },
              ],
            },
            { id: 'includeAlbums', title: 'Include album count', type: 'boolean', defaultValue: true },
            { id: 'limit', title: 'Display limit', type: 'number', defaultValue: 20, min: 1, max: 100, step: 1 },
          ],
        },
      ],
      trackContextMenus: [{
        id: 'inspect-track-action',
        title: 'Inspect track',
        description: 'Show a sanitized format summary for the selected track.',
        commandId: 'inspect-track',
        localOnly: false,
      }],
      playerBarActions: [{
        id: 'library-summary-player-action',
        title: 'Library summary',
        description: 'Run the library summary command from the player bar.',
        commandId: 'library-summary',
        icon: 'sparkles',
      }],
      panels: [{ id: 'main', title, path: 'panel.html', placement: 'utility' }],
      agents: [{
        id: 'library-helper',
        title: 'Library helper',
        description: 'An author-defined Agent that answers from the sanitized library summary.',
        inputPlaceholder: 'Ask about library size',
      }],
      sourceProviders: [{
        id: 'packaged-radio',
        title: 'Packaged catalog',
        description: 'Search a packaged catalog and resolve a user-confirmed direct stream.',
      }],
      lyricsProviders: [{
        id: 'sample-lyrics',
        title: 'Sample lyrics source',
        description: 'Return lyrics candidates from sanitized track metadata.',
      }],
      metadataProviders: [{
        id: 'sample-metadata',
        title: 'Sample metadata provider',
        description: 'Return selectable tag candidates for the current track.',
      }],
      coverProviders: [{
        id: 'sample-covers',
        title: 'Sample cover provider',
        description: 'Return owned or authorized HTTP(S) cover candidates.',
      }],
      themePresets: [{
        id: 'sample-aurora',
        title: 'Aurora import',
        description: 'A declarative appearance the subscriber can import into My themes.',
        basePreset: 'classic',
        preview: 'linear-gradient(135deg, #08111f 0%, #257f96 58%, #f0b35b 100%)',
        swatches: ['#08111f', '#257f96', '#5cc8dc', '#f0b35b'],
        light: { appBg: '#eef8ff', panel: '#ffffff', accent: '#257f96', text: '#234150' },
        dark: { appBg: '#08111f', panel: '#142234', accent: '#5cc8dc', text: '#c8dce8' },
      }],
      settings: [
        {
          id: 'summary-style',
          title: 'Summary style',
          type: 'select',
          defaultValue: 'brief',
          options: [
            { label: 'Brief', value: 'brief' },
            { label: 'Detailed', value: 'detailed' },
          ],
        },
        {
          id: 'show-notifications',
          title: 'Show completion notice',
          type: 'boolean',
          defaultValue: true,
        },
        {
          id: 'accent-color',
          title: 'Panel accent',
          type: 'color',
          defaultValue: '#66ccff',
        },
        {
          id: 'notice-opacity',
          title: 'Notice opacity',
          type: 'range',
          defaultValue: 80,
          min: 0,
          max: 100,
          step: 5,
        },
      ],
    },
  },
  files: [],
});

const createLyricsPluginEntry = (id, title) => ({
  type: 'echo-plugin-package',
  version: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    id,
    name: title,
    version: '1.0.0',
    apiVersion: 2,
    entry: 'plugin.js',
    permissions: [
      'playback:read',
      'library:read',
      'lyrics:provide',
      'lyrics:read',
      'fs:plugin',
    ],
    contributes: {
      commands: [{ id: 'current-lyrics', title: 'Current lyrics' }],
      panels: [{ id: 'lyrics', title, path: 'panel.html', placement: 'lyrics' }],
      lyricsProviders: [{
        id: 'authored-lyrics',
        title: 'Authored lyrics',
        description: 'A user-selectable lyrics source that returns packaged text, never a file path.',
      }],
    },
  },
  files: [],
});

export const createTemplateEntry = (kind, id, title, preset = defaultPresetForKind(kind)) => {
  if (kind === 'theme') {
    return createThemeEntry(preset ?? 'skin', id, title);
  }
  if (kind === 'lyrics-style') return createLyricsStyleEntry(preset ?? 'editorial', id, title);
  if (kind === 'animation-library') {
    return {
      type: 'echo-workshop-animation-library',
      schemaVersion: 1,
      id,
      title,
      description: 'Reusable, host-interpreted animations for ECHO lyrics scenes.',
      animations: [{
        id: 'rise-in',
        title: 'Rise In',
        trigger: 'line-change',
        durationMs: 520,
        easing: 'echo-spring',
        origin: 'bottom',
        clipDirection: 'bottom-to-top',
        stagger: { stepMs: 70, maxDelayMs: 420, from: 'first' },
        keyframes: [
          { offset: 0, opacity: 0, translateY: 28, scale: 0.96, clipProgress: 0 },
          { offset: 1, opacity: 1, translateY: 0, scale: 1, clipProgress: 1 },
        ],
      }],
    };
  }
  if (kind === 'visualizer-preset') return createVisualizerEntry(preset ?? 'bars', id, title);
  if (kind === 'dsp-preset') return createDspEntry(preset ?? 'flat', id, title);
  if (kind === 'locale-pack') {
    return {
      type: 'echo-workshop-locale-pack',
      schemaVersion: 1,
      id,
      title,
      description: 'A Workshop language pack. Missing keys fall back to a built-in locale.',
      locale: 'lzh',
      label: '文言文',
      nativeLabel: '文言',
      fallback: 'zh-CN',
      strings: {
        'settings.general.language.title': '语文',
        'settings.nav.general.label': '通例',
        'settings.nav.appearance.label': '仪容',
        'settings.nav.playback.label': '奏乐',
        'settings.nav.library.label': '乐府',
        'route.workshop.label': '工坊',
        'workshop.kind.localePack': '语文包',
        'workshop.action.use': '用之',
        'queue.action.currentItem': '正奏',
      },
      rewrites: [
        { from: '设置', to: '规制' },
        { from: '播放', to: '奏' },
        { from: '媒体库', to: '乐府' },
        { from: '创意工坊', to: '工坊' },
      ],
    };
  }
  if (kind === 'native-shell') return createNativeShellEntry(id, title);
  if (kind === 'audio-plugin-profile') {
    return {
      type: 'echo-workshop-audio-plugin-profile', schemaVersion: 1, id, title,
      description: 'A binary-free mapping for a VST3 installed by the subscriber.',
      format: 'vst3', role: 'effect',
      plugin: { classId: '00000000000000000000000000000000', name: 'Replace with local plug-in name', vendor: 'Replace with plug-in vendor' },
      adapter: { api: 'echo.audio-plugin-adapter', minimumVersion: 1 },
      routing: { placement: 'post-dsp' },
      parameters: [{ id: 0, title: 'Mix', kind: 'continuous', defaultValue: 1 }],
      presets: [{ id: 'default', title: 'Default', values: { 0: 1 } }],
    };
  }
  if (preset === 'complete') {
    return createCompletePluginEntry(id, title);
  }
  if (preset === fullTrustPluginPreset) {
    return createFullTrustPluginEntry(id, title);
  }
  if (preset === 'catalog') {
    return createCatalogPluginEntry(id, title);
  }
  if (preset === 'lyrics') {
    return createLyricsPluginEntry(id, title);
  }
  return {
    type: 'echo-plugin-package', version: 1, exportedAt: new Date().toISOString(),
    manifest: {
      id, name: title, version: '1.0.0', apiVersion: 2, entry: 'plugin.js',
      permissions: ['playback:read'],
      contributes: { commands: [{ id: 'hello-echo', title: 'Hello ECHO' }] },
    },
    files: [],
  };
};

export const createKindExtraFiles = (kind, preset, id, title) => {
  if (kind === 'theme') return createThemeExtraFiles(preset, id, title);
  if (kind === 'native-shell') return createNativeShellExtraFiles();
  return [];
};

export const inspectProject = (project, manifest, entry) => ({
  id: manifest.id,
  title: manifest.title,
  kind: manifest.content.kind,
  version: manifest.version,
  minEchoVersion: manifest.compatibility?.minEchoVersion ?? null,
  pluginApiVersion: manifest.compatibility?.pluginApiVersion ?? null,
  visibility: project.visibility,
  files: Array.isArray(manifest.files) ? manifest.files.map((file) => file.path) : [],
  customization: manifest.content.kind === 'theme'
    ? describeThemeCustomization(entry)
    : manifest.content.kind === 'plugin-package'
      ? {
          preset: inferKindPreset('plugin-package', entry),
          permissions: entry?.manifest?.permissions ?? [],
          contributions: Object.keys(entry?.manifest?.contributes ?? {}),
        }
      : manifest.content.kind === 'lyrics-style'
        ? describeLyricsCustomization(entry)
        : manifest.content.kind === 'animation-library'
          ? {
              preset: null,
              animationCount: Array.isArray(entry?.animations) ? entry.animations.length : 0,
              animationIds: Array.isArray(entry?.animations)
                ? entry.animations.map((animation) => animation?.id).filter(Boolean)
                : [],
            }
        : manifest.content.kind === 'visualizer-preset'
          ? describeVisualizerCustomization(entry)
          : manifest.content.kind === 'dsp-preset'
            ? describeDspCustomization(entry)
            : manifest.content.kind === 'locale-pack'
              ? {
                  preset: null,
                  locale: entry?.locale ?? null,
                  label: entry?.label ?? null,
                  nativeLabel: entry?.nativeLabel ?? null,
                  stringCount: entry?.strings && typeof entry.strings === 'object'
                    ? Object.keys(entry.strings).length
                    : 0,
                }
              : manifest.content.kind === 'native-shell'
                ? {
                    preset: null,
                    protocolVersion: entry?.protocolVersion ?? null,
                    exe: entry?.exe ?? null,
                    permissions: entry?.permissions ?? [],
                    platforms: entry?.platforms ?? [],
                  }
                : { preset: null },
});
