import {
  collectLyricsSceneSlots,
  createDspEntry,
  createLyricsStyleEntry,
  createVisualizerEntry,
  inferDspPreset,
  inferLyricsPreset,
  inferVisualizerPreset,
  isHexColor,
  lyricsSceneBackgrounds,
  lyricsSceneSlots,
} from './kind-presets.mjs';
import {
  createThemeEntry,
  createThemeExtraFiles,
  inferThemePreset,
  themePresets,
  themeSkinTemplate,
  themeUiCapabilities,
} from './theme-assets.mjs';
import { fullTrustPluginPreset, trustedEntryFileName } from './trusted-plugin.mjs';

export const pluginPermissionWhitelist = [
  'navigation',
  'playback:read',
  'playback:control',
  'playback:share',
  'audio:spectrum',
  'audio:dsp-read',
  'audio:dsp-write',
  'audio:offline-read',
  'library:read',
  'library:control',
  'queue:read',
  'queue:control',
  'sources:provide',
  'sources:direct',
  'network:request',
  'agent:runtime',
  'lyrics:provide',
  'lyrics:read',
  'fs:plugin',
  'fs:export',
  'system:full',
];

const idPattern = /^[a-z0-9](?:[a-z0-9._-]{1,78}[a-z0-9])?$/u;

const titleCase = (value) => value
  .split(/[-.\s]+/u)
  .filter(Boolean)
  .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
  .join(' ');

export const inferProjectIdentity = (directoryName) => {
  const slug = String(directoryName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '');
  const bare = slug.replace(/^echo\./u, '') || 'workshop-item';
  const id = `echo.${bare}`.slice(0, 80);
  return {
    id: idPattern.test(id) ? id : 'echo.workshop-item',
    title: titleCase(bare),
    holder: 'Workshop Author',
  };
};

const uniqueNodeId = (root, base) => {
  const used = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') used.add(node.id);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(root);
  if (!used.has(base)) return base;
  for (let index = 2; index < 50; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a scene node id for ${base}`);
};

export const addLyricsSlot = (entry, slot) => {
  if (!lyricsSceneSlots.includes(slot)) {
    throw new Error(`Unknown lyrics slot ${slot}. Host slots: ${lyricsSceneSlots.join(', ')}`);
  }
  const next = structuredClone(entry);
  if (!next.scene || typeof next.scene !== 'object') {
    next.scene = {
      schemaVersion: 1,
      background: 'cover-blur',
      root: {
        id: 'stage',
        type: 'group',
        children: [
          { id: 'lyrics', type: 'slot', slot: 'lyrics', options: { wordHighlightEnabled: true } },
        ],
      },
    };
  }
  const existing = collectLyricsSceneSlots(next.scene.root);
  if (existing.includes(slot)) {
    throw new Error(`Slot ${slot} is already in the scene`);
  }
  if (!next.scene.root || next.scene.root.type !== 'group' || !Array.isArray(next.scene.root.children)) {
    throw new Error('lyrics scene root must be a group');
  }
  next.scene.root.children.push({
    id: uniqueNodeId(next.scene.root, slot.replace(/[^a-z0-9-]/gu, '-')),
    type: 'slot',
    slot,
  });
  return next;
};

export const addRuntimeCapability = (entry, capability) => {
  if (!themeUiCapabilities.includes(capability)) {
    throw new Error(`Unknown UI capability ${capability}. Allowed: ${themeUiCapabilities.join(', ')}`);
  }
  if (!entry?.runtime || typeof entry.runtime !== 'object') {
    throw new Error('This theme has no UI runtime. scaffold --preset runtime first.');
  }
  const next = structuredClone(entry);
  const capabilities = Array.isArray(next.runtime.capabilities) ? [...next.runtime.capabilities] : [];
  if (capabilities.includes(capability)) {
    throw new Error(`Capability ${capability} is already declared`);
  }
  capabilities.push(capability);
  next.runtime.capabilities = capabilities;
  return next;
};

export const addVisualizerColor = (entry, color) => {
  const hex = String(color ?? '').trim().toLowerCase();
  if (!isHexColor(hex)) throw new Error('Color must be #rrggbb');
  const palette = Array.isArray(entry?.palette) ? [...entry.palette] : [];
  if (palette.map((value) => String(value).toLowerCase()).includes(hex)) {
    throw new Error(`Palette already contains ${hex}`);
  }
  if (palette.length >= 8) throw new Error('Visualizer palette allows at most 8 unique colors');
  return { ...entry, palette: [...palette, hex] };
};

export const addPluginPermission = (entry, permission) => {
  if (!pluginPermissionWhitelist.includes(permission)) {
    throw new Error(`Unknown plug-in permission ${permission}. Allowed: ${pluginPermissionWhitelist.join(', ')}`);
  }
  if (!entry?.manifest || typeof entry.manifest !== 'object') {
    throw new Error('community.echo manifest is missing');
  }
  const next = structuredClone(entry);
  const permissions = Array.isArray(next.manifest.permissions) ? [...next.manifest.permissions] : [];
  if (permissions.includes(permission)) {
    throw new Error(`Permission ${permission} is already declared`);
  }
  next.manifest.permissions = [...permissions, permission];
  if (permission === 'system:full' && !next.manifest.trustedEntry) {
    next.manifest.trustedEntry = trustedEntryFileName;
  }
  return next;
};

export const applyEntryPreset = (kind, preset, current) => {
  const id = current.id;
  const title = current.title;
  if (kind === 'theme') {
    const next = { ...current };
    if (preset === 'skin') next.skin = current.skin ?? themeSkinTemplate;
    if (preset === 'stylesheet' || preset === 'runtime') {
      const generated = createThemeEntry(preset, id, title);
      if (preset === 'stylesheet') next.stylesheet = generated.stylesheet;
      if (preset === 'runtime') next.runtime = current.runtime ?? generated.runtime;
    }
    return { entry: next, extraFiles: createThemeExtraFiles(preset, id, title) };
  }
  if (kind === 'lyrics-style') {
    const generated = createLyricsStyleEntry(preset, id, title);
    return { entry: { ...generated, description: current.description ?? generated.description }, extraFiles: [] };
  }
  if (kind === 'visualizer-preset') {
    const generated = createVisualizerEntry(preset, id, title);
    return {
      entry: {
        ...generated,
        description: current.description ?? generated.description,
        palette: current.palette ?? generated.palette,
      },
      extraFiles: [],
    };
  }
  if (kind === 'dsp-preset') {
    const generated = createDspEntry(preset, id, title);
    return { entry: { ...generated, description: current.description ?? generated.description }, extraFiles: [] };
  }
  throw new Error(`scaffold --preset is not supported for ${kind}`);
};

export const inferKindPreset = (kind, entry) => {
  if (kind === 'theme') return inferThemePreset(entry);
  if (kind === 'lyrics-style') return inferLyricsPreset(entry);
  if (kind === 'visualizer-preset') return inferVisualizerPreset(entry);
  if (kind === 'dsp-preset') return inferDspPreset(entry);
  if (kind === 'plugin-package') {
    if (entry?.manifest?.trustedEntry
      || entry?.manifest?.permissions?.includes('system:full')) return fullTrustPluginPreset;
    const contributes = entry?.manifest?.contributes ?? {};
    if ((Array.isArray(contributes.agents) && contributes.agents.length > 0)
      || (Array.isArray(contributes.themePresets) && contributes.themePresets.length > 0)) {
      return 'complete';
    }
    if (Array.isArray(contributes.sourceProviders) && contributes.sourceProviders.length > 0) {
      return 'catalog';
    }
    if (Array.isArray(contributes.lyricsProviders) && contributes.lyricsProviders.length > 0) {
      return 'lyrics';
    }
    return Array.isArray(contributes.panels) && contributes.panels.length > 0 ? 'complete' : 'basic';
  }
  return null;
};

export const applyEntrySet = (kind, entry, updates) => {
  const next = structuredClone(entry);
  if (updates.title) next.title = updates.title;
  if (updates.description) next.description = updates.description;
  if (kind === 'visualizer-preset') {
    if (updates.style) next.style = updates.style;
    if (updates.barCount !== undefined) next.barCount = updates.barCount;
    if (updates.mirror !== undefined) next.mirror = updates.mirror;
  }
  if (kind === 'lyrics-style') {
    if (!next.settings || typeof next.settings !== 'object') next.settings = {};
    if (updates.pageStyle) next.settings.lyricsPageStyle = updates.pageStyle;
    if (updates.background) {
      if (!lyricsSceneBackgrounds.includes(updates.background)) {
        throw new Error(`Unknown scene background ${updates.background}`);
      }
      if (!next.scene || typeof next.scene !== 'object') {
        throw new Error('This lyrics project has no scene yet. add slot lyrics first, or scaffold a scene preset.');
      }
      next.scene.background = updates.background;
    }
  }
  if (kind === 'dsp-preset' && updates.preampDb !== undefined) next.preampDb = updates.preampDb;
  return next;
};

export const describeNextMoves = (kind, entry) => {
  const moves = [];
  if (kind === 'theme') {
    const layer = inferThemePreset(entry);
    const remaining = themePresets.filter((preset) => (
      preset !== 'colors'
      && !(layer === 'runtime' && preset !== 'runtime')
      && !(preset === 'skin' && entry.skin)
      && !(preset === 'stylesheet' && entry.stylesheet)
      && !(preset === 'runtime' && entry.runtime)
    ));
    for (const preset of remaining) {
      if (preset === 'skin' && layer !== 'colors') continue;
      moves.push(`scaffold . --preset ${preset}`);
    }
    if (entry.runtime) {
      const have = new Set(entry.runtime.capabilities ?? []);
      for (const capability of themeUiCapabilities) {
        if (!have.has(capability)) moves.push(`add . --capability ${capability}`);
      }
    } else {
      moves.push('edit content/theme.json tones, or scaffold a stylesheet / runtime');
    }
  } else if (kind === 'lyrics-style') {
    const have = new Set(collectLyricsSceneSlots(entry?.scene?.root));
    for (const slot of lyricsSceneSlots) {
      if (!have.has(slot)) moves.push(`add . --slot ${slot}`);
    }
    const preset = inferLyricsPreset(entry);
    for (const next of ['editorial', 'compact', 'cinema', 'cover']) {
      if (next !== preset) moves.push(`scaffold . --preset ${next}`);
    }
  } else if (kind === 'visualizer-preset') {
    const palette = Array.isArray(entry?.palette) ? entry.palette : [];
    if (palette.length < 8) moves.push('add . --color #c48bff');
    for (const style of ['bars', 'wave', 'radial']) {
      if (style !== entry?.style) moves.push(`set . --style ${style}`);
    }
  } else if (kind === 'dsp-preset') {
    const preset = inferDspPreset(entry);
    for (const next of ['flat', 'vocal', 'bass', '8bit']) {
      if (next !== preset) moves.push(`scaffold . --preset ${next}`);
    }
    moves.push('set . --preamp -4');
  } else if (kind === 'plugin-package') {
    const have = new Set(entry?.manifest?.permissions ?? []);
    for (const permission of pluginPermissionWhitelist) {
      if (!have.has(permission)) moves.push(`add . --permission ${permission}`);
    }
  } else {
    moves.push('edit the generated JSON, then run npm run check');
  }
  moves.push('npm run check');
  moves.push('npm run dev');
  return moves;
};
