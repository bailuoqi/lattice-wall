import {
  dspPresets,
  lyricsStylePresets,
  visualizerPresets,
} from './kind-presets.mjs';
import { fullTrustMinimumEchoVersion, fullTrustPluginPreset } from './trusted-plugin.mjs';

export const themePresets = ['colors', 'skin', 'stylesheet', 'runtime'];
export const pluginPresets = ['basic', 'complete', 'catalog', 'lyrics', fullTrustPluginPreset];
export { lyricsStylePresets, visualizerPresets, dspPresets };
export const stylesheetMinEchoVersion = '26.8.20';
export const defaultDataMinEchoVersion = '26.8.15';
export const forbiddenThemeBasePresets = ['FINAL', 'nyanCat', 'darkSideMoon'];
export const themeUiCapabilities = [
  'navigation',
  'playback:read',
  'playback:control',
  'library:read',
  'library:control',
  'queue:read',
  'queue:control',
  'window:control',
  'lyrics:read',
  'audio:spectrum',
  'storage',
];

export const defaultPresetForKind = (kind) => {
  if (kind === 'theme') return 'skin';
  if (kind === 'plugin-package') return 'basic';
  if (kind === 'lyrics-style') return 'editorial';
  if (kind === 'visualizer-preset') return 'bars';
  if (kind === 'dsp-preset') return 'flat';
  return null;
};

export const resolveTemplatePreset = (kind, value) => {
  const fallback = defaultPresetForKind(kind);
  const preset = String(value ?? fallback ?? '').trim();
  if (!preset) return null;
  if (kind === 'theme' && themePresets.includes(preset)) return preset;
  if (kind === 'plugin-package' && pluginPresets.includes(preset)) return preset;
  if (kind === 'lyrics-style' && lyricsStylePresets.includes(preset)) return preset;
  if (kind === 'visualizer-preset' && visualizerPresets.includes(preset)) return preset;
  if (kind === 'dsp-preset' && dspPresets.includes(preset)) return preset;
  throw new Error(`Unsupported --preset ${preset} for ${kind}`);
};

export const defaultMinEchoVersionForPreset = (preset) => {
  if (preset === fullTrustPluginPreset) return fullTrustMinimumEchoVersion;
  return preset === 'stylesheet' || preset === 'runtime' ? stylesheetMinEchoVersion : defaultDataMinEchoVersion;
};

export const isEchoVersionAtLeast = (value, minimum) => {
  const parse = (version) => String(version ?? '').split('.').map((part) => Number(part) || 0);
  const [major = 0, minor = 0, patch = 0] = parse(value);
  const [needMajor, needMinor, needPatch] = parse(minimum);
  return major > needMajor
    || (major === needMajor && (minor > needMinor || (minor === needMinor && patch >= needPatch)));
};

const themeTones = {
  dark: {
    appBg: '#10131a',
    appBg2: '#151b26',
    panel: '#182231',
    accent: '#66ccff',
    accentStrong: '#8cdbff',
    heading: '#f5fbff',
    text: '#d8e8f3',
    muted: '#91a7b8',
    border: '#30465a',
    titlebar: '#111924',
    sidebar: '#121d29',
    player: '#172535',
    panelOpacityPercent: 72,
    glassPercent: 30,
    shadowPercent: 58,
    cornerRadiusPx: 18,
    panelBlurPx: 18,
    saturationPercent: 108,
    motionSpeedSeconds: 0.7,
    motionIntensityPercent: 86,
    motionEnabled: true,
  },
  light: {
    appBg: '#eef8fc',
    panel: '#f8fdff',
    accent: '#0b78d0',
    heading: '#132938',
    text: '#254252',
    muted: '#607b8a',
    border: '#b8d3df',
    panelOpacityPercent: 88,
    glassPercent: 18,
    cornerRadiusPx: 18,
    panelBlurPx: 14,
  },
  swatches: ['#10131a', '#182231', '#66ccff', '#8cdbff', '#eef8fc'],
};

export const themeSkinTemplate = {
  mode: 'shell',
  layout: {
    sidebarPosition: 'left',
    sidebarPresentation: 'overlay',
    sidebarWidth: 'wide',
    playerStyle: 'hero',
    titlebarStyle: 'immersive',
    contentDensity: 'editorial',
    cardStyle: 'glass',
    displayStyle: 'editorial',
    navStyle: 'pills',
    motion: 'cinematic',
  },
  stages: {
    home: 'cinema',
    lyrics: 'theater',
    queue: 'tickets',
    songs: 'poster',
    albums: 'magazine',
    artists: 'poster',
    playlists: 'tickets',
    genres: 'poster',
    liked: 'dense',
    history: 'tickets',
  },
  effects: {
    grainPercent: 8,
    vignettePercent: 22,
    glowPercent: 18,
    scrimPercent: 38,
    bloomPercent: 12,
    mistPercent: 6,
    dimChromePercent: 12,
    spotlightPercent: 28,
    frostPercent: 8,
  },
};

export const createThemeEntry = (preset, id, title) => {
  const base = {
    type: 'echo-workshop-theme-preset',
    schemaVersion: 1,
    id,
    title,
    description: preset === 'runtime'
      ? 'A sandboxed replacement UI with a declarative color fallback.'
      : preset === 'stylesheet'
        ? 'A packaged CSS theme scoped to this workshop pack id.'
        : preset === 'skin'
          ? 'A highly customizable, data-only ECHO chrome skin.'
          : 'A complete light and dark appearance preset for ECHO.',
    basePreset: 'classic',
    dark: themeTones.dark,
    light: themeTones.light,
    swatches: themeTones.swatches,
  };
  if (preset === 'skin') return { ...base, skin: themeSkinTemplate };
  if (preset === 'stylesheet') return { ...base, stylesheet: 'theme.css' };
  if (preset === 'runtime') {
    return {
      ...base,
      runtime: {
        entry: 'ui/index.html',
        capabilities: [...themeUiCapabilities],
      },
    };
  }
  return base;
};

export const createThemeStylesheetCss = (id) => `html[data-workshop-theme-pack="${id}"] {
  --color-bg: #10131a;
  --color-text: #d8e8f3;
  --color-muted: #91a7b8;
  --color-accent: #66ccff;
  --color-accent-strong: #8cdbff;
  --echo-heading-text: #f5fbff;
  --theme-app-bg: #10131a;
  --theme-page-text: #d8e8f3;
  --theme-heading-text: #f5fbff;
  --theme-muted-text: #91a7b8;
  --theme-panel-bg: #182231;
  --theme-player-bg: #172535;
  color-scheme: dark;
}

html[data-workshop-theme-pack="${id}"] body,
html[data-workshop-theme-pack="${id}"] .app-shell {
  background: radial-gradient(circle at 12% 8%, rgb(102 204 255 / 0.16), transparent 34%),
    linear-gradient(160deg, #10131a 0%, #151b26 54%, #0d1218 100%);
  color: var(--color-text);
}

html[data-workshop-theme-pack="${id}"] .app-titlebar,
html[data-workshop-theme-pack="${id}"] .sidebar,
html[data-workshop-theme-pack="${id}"] .player-bar,
html[data-workshop-theme-pack="${id}"] .page-surface {
  background: rgb(24 34 49 / 0.72);
  border-color: rgb(48 70 90 / 0.45);
}

html[data-workshop-theme-pack="${id}"] .sidebar {
  backdrop-filter: blur(18px);
}

html[data-workshop-theme-pack="${id}"] .player-bar {
  border-top: 1px solid rgb(102 204 255 / 0.22);
}
`;

export const createThemeRuntimeHtml = (title) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="app.css">
</head>
<body>
  <div id="app">
    <header class="top">
      <strong id="brand">${title}</strong>
      <input id="search" type="search" placeholder="Search library" autocomplete="off">
    </header>
    <main>
      <section>
        <h2>Tracks</h2>
        <ol id="tracks"></ol>
      </section>
      <section>
        <h2>Albums</h2>
        <ol id="albums"></ol>
      </section>
      <section>
        <h2>Queue</h2>
        <ol id="queue"></ol>
      </section>
    </main>
    <footer class="player">
      <div>
        <p id="now-title">Nothing playing</p>
        <p id="now-artist" class="muted"></p>
        <p id="now-lyrics" class="muted"></p>
      </div>
      <div id="spectrum" class="spectrum" aria-hidden="true"></div>
      <div class="transport">
        <button id="previous" type="button">Prev</button>
        <button id="play-pause" type="button">Play</button>
        <button id="next" type="button">Next</button>
        <button id="shuffle" type="button">Shuffle</button>
        <button id="repeat" type="button">Repeat</button>
        <button id="like" type="button">Like</button>
      </div>
    </footer>
  </div>
  <script src="app.js"></script>
</body>
</html>
`;

export const createThemeRuntimeCss = () => `:root {
  color-scheme: dark;
  --ink: #f4fbff;
  --muted: #8eabc0;
  --line: #2a3d52;
  --panel: #121b26;
  --accent: #7ad4ff;
  font-family: "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #0c1219; color: var(--ink); }
#app { min-height: 100%; display: grid; grid-template-rows: auto 1fr auto; }
.top, .player {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--panel);
}
.top { border-bottom: 1px solid var(--line); }
.player { border-top: 1px solid var(--line); }
main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr); gap: 20px; padding: 20px; }
h2 { margin: 0 0 12px; font-size: 15px; color: var(--accent); }
ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.spectrum { display: flex; gap: 2px; height: 28px; align-items: flex-end; min-width: 120px; }
.spectrum span { flex: 1; background: var(--accent); min-height: 2px; border-radius: 1px; }
li, button, input {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #182433;
  color: inherit;
}
li, button { padding: 10px 12px; cursor: pointer; text-align: left; }
input { min-width: 220px; padding: 10px 12px; }
.muted { color: var(--muted); margin: 4px 0 0; }
.transport { display: flex; gap: 8px; }
p { margin: 0; }
@media (max-width: 860px) {
  main { grid-template-columns: 1fr; }
  .top, .player { flex-wrap: wrap; }
}
`;

export const createThemeRuntimeJs = () => `const pending = new Map();
let requestSeq = 0;
let currentTrackId = null;
let libraryRevision = 0;

const command = (name, payload = {}) => new Promise((resolve, reject) => {
  const requestId = \`sdk-\${++requestSeq}\`;
  pending.set(requestId, { resolve, reject });
  parent.postMessage({ type: 'echo:workshop-ui:command', requestId, command: name, payload }, '*');
});

const text = (id, value) => {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
};

const renderList = (id, items, onClick) => {
  const list = document.getElementById(id);
  if (!list) return;
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    row.textContent = item.label;
    row.addEventListener('click', () => onClick(item));
    list.append(row);
  }
};

const applyAppearance = (appearance) => {
  if (!appearance || typeof appearance !== 'object') return;
  const root = document.documentElement.style;
  if (appearance.accent) root.setProperty('--accent', appearance.accent);
  if (appearance.panel) root.setProperty('--panel', appearance.panel);
  if (appearance.text) root.setProperty('--ink', appearance.text);
  if (appearance.muted) root.setProperty('--muted', appearance.muted);
  if (appearance.border) root.setProperty('--line', appearance.border);
  if (appearance.appBg) document.body.style.background = appearance.appBg;
};

const refreshLibrary = async (search = '') => {
  const page = await command('library:listTracks', { page: 1, pageSize: 40, search });
  const items = Array.isArray(page?.items) ? page.items : [];
  renderList('tracks', items.map((track) => ({
    id: track.id,
    label: \`\${track.title || 'Untitled'} · \${track.artist || 'Unknown artist'}\`,
  })), (track) => command('queue:playTrack', { trackId: track.id }));
  const albums = await command('library:listAlbums', { page: 1, pageSize: 24, search }).catch(() => ({ items: [] }));
  const albumItems = Array.isArray(albums?.items) ? albums.items : [];
  renderList('albums', albumItems.map((album) => ({
    id: album.id,
    label: \`\${album.title || 'Album'} · \${album.albumArtist || ''}\`,
  })), async (album) => {
    await command('queue:playAlbum', { albumId: album.id });
  });
};

const paintSpectrum = (spectrum) => {
  const root = document.getElementById('spectrum');
  if (!root) return;
  const bands = Array.isArray(spectrum?.bands) ? spectrum.bands.slice(0, 24) : [];
  root.replaceChildren();
  for (const band of bands) {
    const bar = document.createElement('span');
    bar.style.height = \`\${Math.max(8, Math.round((Number(band) || 0) * 100))}%\`;
    root.append(bar);
  }
};

const refreshLyrics = async (trackId) => {
  if (!trackId) { text('now-lyrics', ''); return; }
  const lyrics = await command('lyrics:get', { trackId }).catch(() => null);
  const line = Array.isArray(lyrics?.lines) && lyrics.lines[0] ? lyrics.lines[0].text : '';
  text('now-lyrics', line || '');
};

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'echo:workshop-ui:init') {
    applyAppearance(data.appearance);
    return;
  }
  if (data.type === 'echo:workshop-ui:state') {
    const nextId = data.playback?.currentTrackId ?? data.currentTrack?.id ?? null;
    if (nextId !== currentTrackId) {
      currentTrackId = nextId;
      if (!data.lyrics) void refreshLyrics(currentTrackId);
    }
    text('now-title', data.currentTrack?.title || (data.playback?.state === 'playing' ? 'Playing' : 'Nothing playing'));
    text('now-artist', data.currentTrack?.artist || '');
    text('now-lyrics', data.lyrics?.currentText || '');
    text('play-pause', data.playback?.state === 'playing' ? 'Pause' : 'Play');
    text('shuffle', data.playback?.shuffleEnabled ? 'Shuffle on' : 'Shuffle');
    text('repeat', data.playback?.repeatMode === 'one' ? 'Repeat one' : data.playback?.repeatMode === 'all' ? 'Repeat all' : 'Repeat');
    text('like', data.currentTrack?.liked ? 'Liked' : 'Like');
    paintSpectrum(data.spectrum);
    if (typeof data.library?.revision === 'number' && data.library.revision > libraryRevision) {
      libraryRevision = data.library.revision;
      void refreshLibrary(String(document.getElementById('search')?.value || '').trim());
    }
    const queueItems = Array.isArray(data.queue?.items) ? data.queue.items : [];
    renderList('queue', queueItems.map((item) => ({
      id: item.queueId,
      label: item.track?.title || item.queueId,
    })), (item) => command('queue:playItem', { queueId: item.id }));
    return;
  }
  if (data.type !== 'echo:workshop-ui:result') return;
  const waiter = pending.get(data.requestId);
  if (!waiter) return;
  pending.delete(data.requestId);
  if (data.ok) waiter.resolve(data.value);
  else waiter.reject(new Error(data.error || 'command-failed'));
});

document.getElementById('search')?.addEventListener('input', (event) => {
  const query = String(event.target.value || '').trim();
  void command('storage:set', { key: 'search', value: query }).catch(() => undefined);
  void refreshLibrary(query);
});
document.getElementById('play-pause')?.addEventListener('click', () => { void command('playPause'); });
document.getElementById('previous')?.addEventListener('click', () => { void command('previous'); });
document.getElementById('next')?.addEventListener('click', () => { void command('next'); });
document.getElementById('shuffle')?.addEventListener('click', () => { void command('toggleShuffle'); });
document.getElementById('repeat')?.addEventListener('click', () => { void command('cycleRepeat'); });
document.getElementById('like')?.addEventListener('click', () => {
  if (currentTrackId) void command('library:toggleLiked', { trackId: currentTrackId });
});

parent.postMessage({ type: 'echo:workshop-ui:ready' }, '*');
void command('storage:get', { key: 'search' }).then((value) => {
  const query = typeof value === 'string' ? value : '';
  const search = document.getElementById('search');
  if (search && query) search.value = query;
  return refreshLibrary(query);
}).catch(() => refreshLibrary());
`;

export const createThemeExtraFiles = (preset, id, title) => {
  if (preset === 'stylesheet') {
    return [{ path: 'theme.css', content: createThemeStylesheetCss(id) }];
  }
  if (preset === 'runtime') {
    return [
      { path: 'ui/index.html', content: createThemeRuntimeHtml(title) },
      { path: 'ui/app.css', content: createThemeRuntimeCss() },
      { path: 'ui/app.js', content: createThemeRuntimeJs() },
    ];
  }
  return [];
};

export const inferThemePreset = (entry) => {
  if (entry?.runtime?.entry) return 'runtime';
  if (typeof entry?.stylesheet === 'string' && entry.stylesheet.trim()) return 'stylesheet';
  if (entry?.skin && typeof entry.skin === 'object') return 'skin';
  return 'colors';
};

export const describeThemeCustomization = (entry) => ({
  preset: inferThemePreset(entry),
  basePreset: typeof entry?.basePreset === 'string' ? entry.basePreset : null,
  tones: {
    light: Boolean(entry?.light && typeof entry.light === 'object'),
    dark: Boolean(entry?.dark && typeof entry.dark === 'object'),
  },
  skin: Boolean(entry?.skin && typeof entry.skin === 'object'),
  stylesheet: typeof entry?.stylesheet === 'string' ? entry.stylesheet : null,
  runtime: entry?.runtime && typeof entry.runtime === 'object'
    ? {
        entry: entry.runtime.entry ?? null,
        capabilities: Array.isArray(entry.runtime.capabilities) ? entry.runtime.capabilities : [],
      }
    : null,
});
