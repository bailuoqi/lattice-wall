import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMERA_SAVE_DEBOUNCE_MS,
  createHostBridge,
  deriveMissingCapabilities,
  SEEK_THROTTLE_MS,
} from '../source/panel/host/bridge.ts';
import { ALBUM_PROBES } from '../source/panel/albums/albumModel.ts';
import {
  buildQueueModel,
  diffQueueModel,
  FALLBACK_ARTIST,
  FALLBACK_TITLE,
  QUEUE_TRUNCATION_LIMIT,
} from '../source/panel/host/queueModel.ts';
import {
  cellMetricsFor,
  DEFAULT_SETTINGS,
  FALLBACK_TINT,
  resolveSettings,
  resolveTintColor,
  SETTING_IDS,
  sanitizeUiFont,
  settingEntries,
  controlPanelSettingLocks,
  wallExpandedScale,
  wallOverviewScale,
  wallVisualsFromSettings,
} from '../source/panel/host/settings.ts';

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

const flush = () => new Promise((resolve) => setImmediate(resolve));

const track = (i, overrides = {}) => ({
  id: `track-${i}`,
  mediaType: 'local',
  title: `Title ${i}`,
  artist: `Artist ${i}`,
  album: `Album ${i}`,
  albumArtist: `Artist ${i}`,
  trackNo: i,
  discNo: 1,
  year: 2024,
  genre: null,
  durationSeconds: 200 + i,
  codec: 'flac',
  sampleRate: 44_100,
  bitDepth: 16,
  bitrate: null,
  coverUrl: `echo-cover://track-${i}`,
  unavailable: false,
  ...overrides,
});

const snapshot = (count, currentIndex = 0, overrides = {}) => ({
  currentQueueId: currentIndex === null ? null : `queue-${currentIndex}`,
  currentTrack: currentIndex === null ? null : track(currentIndex),
  canGoPrevious: true,
  canGoNext: true,
  shuffleEnabled: false,
  repeatMode: 'off',
  items: Array.from({ length: count }, (_, i) => ({ queueId: `queue-${i}`, track: track(i) })),
  ...overrides,
});

const feature = (granted = true, available = true) => ({
  supported: true,
  granted,
  available,
  reason: granted && available ? null : 'capability-not-approved',
});

const allFeatures = () => Object.fromEntries(
  ['playback:getStatus', 'playback:play', 'library:getTracks', 'queue:playTrack', 'lyrics:get', 'settings:get', 'storage:get']
    .map((id) => [id, feature()]),
);

const context = () => ({
  surface: 'panel',
  panel: { id: 'wall', placement: 'player' },
  visible: true,
  locale: 'zh-CN',
  direction: 'ltr',
  colorScheme: 'dark',
  reducedMotion: false,
  viewport: { width: 1280, height: 720 },
  appearance: {
    accent: '#5cc8dc', accentText: '#08111f', panel: '#142234', text: '#c8dce8', heading: '#f4fbff',
    muted: '#8eabc0', appBg: '#08111f', border: '#2a3d52', player: '#142234',
  },
  presentation: null,
});

const status = () => ({ state: 'playing', currentTrackId: 'track-7', positionSeconds: 42, durationSeconds: 221, volume: 1 });

function createFakeTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const runUntil = (until) => {
    for (;;) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.at <= until && (next === null || timer.at < next.at || (timer.at === next.at && id < next.id))) {
          next = { id, ...timer };
        }
      }
      if (!next) break;
      timers.delete(next.id);
      now = next.at;
      next.fn();
    }
    now = until;
  };
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    advance: (ms) => runUntil(now + ms),
    pending: () => timers.size,
  };
}

/** A fake `echo` whose every host method is routed through `impls[action]` and logged to `calls`. */
function createFakeEcho(now = () => 0) {
  const calls = [];
  const listeners = new Map();
  const on = (name, handler) => {
    const set = listeners.get(name) ?? new Set();
    set.add(handler);
    listeners.set(name, set);
    return () => set.delete(handler);
  };
  const impls = {
    'host:getCapabilities': () => Promise.resolve({ apiVersion: 2, features: allFeatures() }),
    'ui:getContext': () => Promise.resolve(context()),
    'ui:setPanelPresentation': (presentation) => Promise.resolve({
      title: presentation.title, badge: null, dirty: false, attention: 'none', size: presentation.size,
    }),
    'ui:closePanel': () => Promise.resolve(null),
    'ui:openPanel': (panelId) => Promise.resolve(panelId ? { id: panelId, title: panelId } : null),
    'settings:get': () => Promise.resolve({ 'lights-out': true, 'cell-size': 'L' }),
    'settings:set': () => Promise.resolve({}),
    'storage:get': () => Promise.resolve({ x: 10.4, y: -3.6 }),
    'storage:set': () => Promise.resolve(null),
    'queue:get': () => Promise.resolve(snapshot(3, 1)),
    'queue:playItem': () => Promise.resolve(null),
    'queue:playTrack': () => Promise.resolve({ track: null, count: 1 }),
    'playback:getStatus': () => Promise.resolve(status()),
    'playback:play': () => Promise.resolve(null),
    'playback:pause': () => Promise.resolve(null),
    'playback:seek': () => Promise.resolve(null),
    'playback:next': () => Promise.resolve(null),
    'playback:previous': () => Promise.resolve(null),
    'playback:toggleShuffle': () => Promise.resolve(null),
    'playback:setRepeat': () => Promise.resolve(null),
    'lyrics:get': () => Promise.resolve({ kind: 'plain', lines: [], plainText: 'la la' }),
  };
  const call = (action) => (...args) => {
    calls.push({ action, args, at: now() });
    return impls[action](...args);
  };
  const api = {
    host: { getCapabilities: call('host:getCapabilities') },
    ui: {
      getContext: call('ui:getContext'),
      setPanelPresentation: call('ui:setPanelPresentation'),
      closePanel: call('ui:closePanel'),
      openPanel: call('ui:openPanel'),
      onContextChanged: (handler) => on('ui:context-changed', handler),
    },
    settings: {
      get: call('settings:get'),
      set: call('settings:set'),
      onChanged: (handler) => on('settings:changed', handler),
    },
    storage: { get: call('storage:get'), set: call('storage:set') },
    queue: { get: call('queue:get'), playItem: call('queue:playItem'), playTrack: call('queue:playTrack') },
    playback: {
      getStatus: call('playback:getStatus'),
      play: call('playback:play'),
      pause: call('playback:pause'),
      seek: call('playback:seek'),
      next: call('playback:next'),
      previous: call('playback:previous'),
      toggleShuffle: call('playback:toggleShuffle'),
      setRepeat: call('playback:setRepeat'),
    },
    lyrics: { get: call('lyrics:get') },
    events: { on },
  };
  const emit = (name, payload) => {
    for (const handler of listeners.get(name) ?? []) handler(payload);
  };
  const of = (action) => calls.filter((entry) => entry.action === action);
  return { api, calls, impls, emit, of, listeners };
}

const collectErrors = (bridge) => {
  const errors = [];
  bridge.onError((message) => errors.push(message));
  return errors;
};

// ---------------------------------------------------------------------------------------------------
// Queue model
// ---------------------------------------------------------------------------------------------------

test('buildQueueModel: null snapshot yields an empty model', () => {
  assert.deepEqual(buildQueueModel(null), { tiles: [], currentIndex: null, currentQueueId: null, truncated: false });
});

test('buildQueueModel: maps and sanitises items', () => {
  const model = buildQueueModel(snapshot(3, 1, {
    items: [
      { queueId: 'q0', track: track(0) },
      { queueId: 'q1', track: track(1, { title: '   ', artist: null, album: undefined, coverUrl: '', durationSeconds: Number.NaN }) },
      { queueId: '', track: track(9) },
      { queueId: 'q2', track: { title: 'No id' } },
      null,
      { queueId: 'q3', track: track(3, { durationSeconds: -4, coverUrl: null }) },
    ],
    currentQueueId: 'q2',
  }));
  assert.equal(model.tiles.length, 4);
  assert.deepEqual(model.tiles.map((tile) => tile.index), [0, 1, 2, 3]);
  assert.deepEqual(model.tiles[0], {
    index: 0, queueId: 'q0', trackId: 'track-0', title: 'Title 0', artist: 'Artist 0', album: 'Album 0',
    coverUrl: 'echo-cover://track-0', durationSeconds: 200,
  });
  assert.equal(model.tiles[1].title, FALLBACK_TITLE);
  assert.equal(model.tiles[1].artist, FALLBACK_ARTIST);
  assert.equal(model.tiles[1].album, '');
  assert.equal(model.tiles[1].coverUrl, null);
  assert.equal(model.tiles[1].durationSeconds, 0);
  assert.equal(model.tiles[2].trackId, 'q2', 'trackId falls back to the queue id');
  assert.equal(model.tiles[3].durationSeconds, 0);
  assert.equal(model.currentIndex, 2);
  assert.equal(model.currentQueueId, 'q2');
  assert.equal(model.truncated, false);
});

test('buildQueueModel: current index is null when the id is absent', () => {
  assert.equal(buildQueueModel(snapshot(3, null)).currentIndex, null);
  assert.equal(buildQueueModel(snapshot(3, 0, { currentQueueId: 'missing' })).currentIndex, null);
});

test('buildQueueModel: flags the host truncation cap', () => {
  assert.equal(buildQueueModel(snapshot(QUEUE_TRUNCATION_LIMIT - 1, 0)).truncated, false);
  assert.equal(buildQueueModel(snapshot(QUEUE_TRUNCATION_LIMIT, 233)).truncated, true);
  assert.equal(buildQueueModel(snapshot(QUEUE_TRUNCATION_LIMIT, 233)).currentIndex, 233);
});

test('diffQueueModel: detects order/id changes and current changes independently', () => {
  const a = buildQueueModel(snapshot(4, 1));
  assert.deepEqual(diffQueueModel(a, buildQueueModel(snapshot(4, 1))), { tilesChanged: false, currentChanged: false });
  assert.deepEqual(diffQueueModel(a, buildQueueModel(snapshot(4, 2))), { tilesChanged: false, currentChanged: true });
  assert.deepEqual(diffQueueModel(a, buildQueueModel(snapshot(5, 1))), { tilesChanged: true, currentChanged: false });
  const reordered = snapshot(4, 1);
  reordered.items.reverse();
  assert.deepEqual(diffQueueModel(a, buildQueueModel(reordered)), { tilesChanged: true, currentChanged: true });
  assert.deepEqual(diffQueueModel(a, buildQueueModel(snapshot(4, null))), { tilesChanged: false, currentChanged: true });
  assert.deepEqual(diffQueueModel(buildQueueModel(null), buildQueueModel(null)), { tilesChanged: false, currentChanged: false });
});

// ---------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------

test('resolveSettings: empty or malformed input yields the defaults', () => {
  assert.deepEqual(resolveSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(resolveSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(resolveSettings({ immersive: 'true', 'auto-focus': 1, 'cell-size': 'XL', 'poster-tint-color': 'red', 'poster-tint-intensity': 'x' }), DEFAULT_SETTINGS);
});

test('resolveSettings: reads manifest ids and validates ranges', () => {
  const resolved = resolveSettings({
    [SETTING_IDS.immersive]: false,
    [SETTING_IDS.autoFocus]: false,
    [SETTING_IDS.vignette]: false,
    [SETTING_IDS.lightsOut]: true,
    [SETTING_IDS.posterTint]: false,
    [SETTING_IDS.posterTintCustom]: true,
    [SETTING_IDS.posterTintColor]: '#ABCDEF',
    [SETTING_IDS.posterTintIntensity]: 0.75,
    [SETTING_IDS.cellSize]: 'L',
    [SETTING_IDS.showLyrics]: false,
    [SETTING_IDS.showTranslation]: false,
  });
  assert.deepEqual(resolved, {
    immersive: false, autoFocus: false, lightingMode: 'spotlight', vignette: false, lightsOut: true, posterTint: false,
    posterTintCustom: true, posterTintColor: '#abcdef', posterTintIntensity: 0.75, cellSize: 'L', showLyrics: false,
    showTranslation: false, uiFont: '',
  });
  assert.equal(resolveSettings({ 'poster-tint-intensity': 4 }).posterTintIntensity, 1);
  assert.equal(resolveSettings({ 'poster-tint-intensity': -1 }).posterTintIntensity, 0);
  assert.equal(resolveSettings({ 'poster-tint-intensity': Number.NaN }).posterTintIntensity, 0.5);
  assert.equal(resolveSettings({ 'poster-tint-color': '#abc' }).posterTintColor, '#000000', 'short hex is not a valid manifest colour');
  assert.equal(resolveSettings({ 'cell-size': 'S' }).cellSize, 'S');
});

test('SETTING_IDS covers every manifest setting id exactly once', () => {
  assert.deepEqual(Object.values(SETTING_IDS).sort(), [
    'auto-focus', 'cell-size', 'immersive', 'lighting-mode', 'lights-out', 'poster-tint', 'poster-tint-color',
    'poster-tint-custom', 'poster-tint-intensity', 'show-lyrics', 'show-translation', 'ui-font', 'vignette',
  ]);
});

test('resolveSettings: lighting mode and ui font are sanitized', () => {
  assert.equal(resolveSettings({ 'lighting-mode': 'daytime' }).lightingMode, 'daytime');
  assert.equal(resolveSettings({ 'lighting-mode': 'neon' }).lightingMode, 'spotlight');
  assert.equal(resolveSettings({ 'ui-font': 'Georgia, serif' }).uiFont, 'Georgia, serif');
  assert.equal(resolveSettings({ 'ui-font': 'url(https://evil)' }).uiFont, '');
});

test('sanitizeUiFont rejects injection and keeps a short stack', () => {
  assert.equal(sanitizeUiFont('Inter, system-ui, sans-serif'), 'Inter, system-ui, sans-serif');
  assert.equal(sanitizeUiFont('微软雅黑'), '微软雅黑');
  assert.equal(sanitizeUiFont('foo; background:red'), '');
  assert.equal(sanitizeUiFont('x'.repeat(120)), 'x'.repeat(80));
});

test('wallVisualsFromSettings: daytime turns off shade, tint and vignette', () => {
  const daytime = wallVisualsFromSettings({ ...DEFAULT_SETTINGS, lightingMode: 'daytime', lightsOut: true }, false);
  assert.deepEqual(daytime, {
    lightsOut: false, vignette: false, tint: false, tintColor: '#000000', tintIntensity: 0, reducedMotion: false,
  });
  const spotlight = wallVisualsFromSettings({ ...DEFAULT_SETTINGS, lightsOut: true }, true);
  assert.equal(spotlight.lightsOut, true);
  assert.equal(spotlight.vignette, true);
  assert.equal(spotlight.tint, true);
  assert.equal(spotlight.reducedMotion, true);
});

test('settingEntries maps runtime keys to manifest ids', () => {
  assert.deepEqual(settingEntries({ lightingMode: 'daytime', uiFont: 'Georgia, serif' }), [
    ['lighting-mode', 'daytime'],
    ['ui-font', 'Georgia, serif'],
  ]);
});

test('cellMetricsFor: S/M/L sides with an 8 px gap', () => {
  assert.deepEqual(cellMetricsFor('S'), { cell: 104, gap: 8 });
  assert.deepEqual(cellMetricsFor('M'), { cell: 128, gap: 8 });
  assert.deepEqual(cellMetricsFor('L'), { cell: 152, gap: 8 });
});

test('wallOverviewScale: narrower viewports pull the camera further back', () => {
  assert.equal(wallOverviewScale(0), 0.6);
  assert.equal(wallOverviewScale(640), 0.42);
  assert.equal(wallOverviewScale(1000), 0.52);
  assert.equal(wallOverviewScale(1600), 0.6);
});

test('wallExpandedScale: closer than the wall, still short of filling the viewport', () => {
  assert.equal(wallExpandedScale(0), 0.78);
  assert.equal(wallExpandedScale(640), 0.55);
  assert.equal(wallExpandedScale(1000), 0.68);
  assert.equal(wallExpandedScale(1600), 0.78);
  assert.ok(wallExpandedScale(1600) > wallOverviewScale(1600));
  assert.ok(wallExpandedScale(1600) < 1);
});

test('resolveTintColor: neutral black unless custom colour is explicitly enabled', () => {
  assert.equal(resolveTintColor(DEFAULT_SETTINGS), '#000000');
  assert.equal(resolveTintColor({ ...DEFAULT_SETTINGS, posterTintColor: '#161419' }), FALLBACK_TINT);
  assert.equal(resolveTintColor({ ...DEFAULT_SETTINGS, posterTintCustom: true, posterTintColor: '#123456' }), '#123456');
});

test('controlPanelSettingLocks: daytime and tint stay independent', () => {
  assert.deepEqual(controlPanelSettingLocks(DEFAULT_SETTINGS), { spotlight: true, tint: true, customColor: false });
  assert.deepEqual(controlPanelSettingLocks({ ...DEFAULT_SETTINGS, posterTintCustom: true }), {
    spotlight: true, tint: true, customColor: true,
  });
  assert.deepEqual(controlPanelSettingLocks({ ...DEFAULT_SETTINGS, posterTint: false, posterTintCustom: true }), {
    spotlight: true, tint: false, customColor: false,
  });
  assert.deepEqual(controlPanelSettingLocks({
    ...DEFAULT_SETTINGS, lightingMode: 'daytime', posterTint: true, posterTintCustom: true,
  }), { spotlight: false, tint: false, customColor: false });
});

// ---------------------------------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------------------------------

test('deriveMissingCapabilities: representative actions decide each permission', () => {
  const features = allFeatures();
  features['library:getTracks'] = feature(false);
  features['lyrics:get'] = feature(true, false);
  delete features['playback:play'];
  assert.deepEqual(deriveMissingCapabilities({ apiVersion: 2, features }), ['library:read', 'playback:control', 'lyrics:read']);
  assert.deepEqual(deriveMissingCapabilities({ apiVersion: 2, features: allFeatures() }), []);
  assert.deepEqual(deriveMissingCapabilities(null), []);
  assert.deepEqual(deriveMissingCapabilities({ apiVersion: 2 }), []);
});

test('boot: startup burst is at most 6 requests, capabilities and context first', async () => {
  const fake = createFakeEcho();
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  const boot = await bridge.boot();
  assert.deepEqual(fake.calls.map((entry) => entry.action), [
    'host:getCapabilities', 'ui:getContext', 'settings:get', 'playback:getStatus', 'storage:get',
  ]);
  assert.deepEqual(fake.of('storage:get')[0].args, ['camera']);
  assert.deepEqual(boot.missing, []);
  assert.equal(boot.context.viewport.width, 1280);
  assert.deepEqual(boot.settings, { 'lights-out': true, 'cell-size': 'L' });
  assert.equal(boot.queue, null);
  assert.equal(boot.status.positionSeconds, 42);
  assert.deepEqual(boot.camera, { x: 10.4, y: -3.6 });
  assert.deepEqual(errors, []);
});

test('boot: album probes still read the queue snapshot', async () => {
  const fake = createFakeEcho();
  const features = allFeatures();
  for (const [, action] of ALBUM_PROBES) features[action] = feature();
  fake.impls['host:getCapabilities'] = () => Promise.resolve({ apiVersion: 2, features });
  const boot = await createHostBridge(fake.api, { ...createFakeTimers(), probes: ALBUM_PROBES }).boot();
  assert.deepEqual(boot.missing, []);
  assert.equal(boot.queue.items.length, 3);
  assert.equal(fake.of('queue:get').length, 1);
});

test('boot: skips reads for missing capabilities and reports them', async () => {
  const fake = createFakeEcho();
  const features = allFeatures();
  features['library:getTracks'] = feature(false);
  fake.impls['host:getCapabilities'] = () => Promise.resolve({ apiVersion: 2, features });
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const boot = await bridge.boot();
  assert.deepEqual(boot.missing, ['library:read']);
  assert.equal(boot.queue, null);
  assert.equal(fake.of('queue:get').length, 0);
  assert.equal(fake.calls.length, 5);
  assert.equal(boot.status.state, 'playing');
});

test('boot: a denied fs:plugin skips settings and storage', async () => {
  const fake = createFakeEcho();
  const features = allFeatures();
  features['settings:get'] = feature(false);
  fake.impls['host:getCapabilities'] = () => Promise.resolve({ apiVersion: 2, features });
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const boot = await bridge.boot();
  assert.deepEqual(boot.missing, ['fs:plugin']);
  assert.deepEqual(boot.settings, {});
  assert.equal(boot.camera, null);
  assert.equal(fake.of('settings:get').length, 0);
  assert.equal(fake.of('storage:get').length, 0);
  assert.equal(fake.calls.length, 3);
});

test('boot: a failing getCapabilities treats nothing as missing', async () => {
  const fake = createFakeEcho();
  fake.impls['host:getCapabilities'] = () => Promise.reject(new Error('plugin-request-timeout'));
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  const boot = await bridge.boot();
  assert.deepEqual(boot.missing, []);
  assert.equal(fake.calls.length, 5);
  assert.deepEqual(errors, ['host:getCapabilities: plugin-request-timeout']);
});

test('boot: individual read failures and bad shapes degrade to null/empty and are reported', async () => {
  const fake = createFakeEcho();
  fake.impls['playback:getStatus'] = () => Promise.reject(new Error('playback-unavailable'));
  fake.impls['settings:get'] = () => { throw new Error('sync-throw'); };
  fake.impls['storage:get'] = () => Promise.resolve({ x: 'a', y: 2 });
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  const boot = await bridge.boot();
  assert.equal(boot.status, null);
  assert.equal(boot.queue, null);
  assert.deepEqual(boot.settings, {});
  assert.equal(boot.camera, null);
  assert.deepEqual(errors.sort(), [
    'playback:getStatus: playback-unavailable',
    'settings:get: sync-throw',
  ]);
});

test('boot: camera must be a finite point', async () => {
  for (const [stored, expected] of [
    [{ x: 1, y: 2 }, { x: 1, y: 2 }],
    [{ x: Number.POSITIVE_INFINITY, y: 2 }, null],
    [{ x: 1 }, null],
    ['{"x":1,"y":2}', null],
    [null, null],
  ]) {
    const fake = createFakeEcho();
    fake.impls['storage:get'] = () => Promise.resolve(stored);
    const boot = await createHostBridge(fake.api, createFakeTimers()).boot();
    assert.deepEqual(boot.camera, expected);
  }
});

test('boot: rejects only when ui.getContext fails', async () => {
  const fake = createFakeEcho();
  fake.impls['ui:getContext'] = () => Promise.reject(new Error('panel-context-required'));
  const bridge = createHostBridge(fake.api, createFakeTimers());
  await assert.rejects(bridge.boot(), /panel-context-required/);
});

test('requestPresentation: immersive → full → unchanged fallback chain', async () => {
  const fake = createFakeEcho();
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  assert.equal(await bridge.requestPresentation('Lattice', true), 'immersive');
  assert.deepEqual(fake.of('ui:setPanelPresentation').at(-1).args, [{ size: 'immersive', title: 'Lattice' }]);
  assert.equal(await bridge.requestPresentation('Lattice', false), 'full');
  assert.deepEqual(fake.of('ui:setPanelPresentation').at(-1).args, [{ size: 'full', title: 'Lattice' }]);

  fake.impls['ui:setPanelPresentation'] = (presentation) => (presentation.size === 'immersive'
    ? Promise.reject(new Error('invalid-payload'))
    : Promise.resolve({ title: presentation.title, badge: null, dirty: false, attention: 'none', size: presentation.size }));
  assert.equal(await bridge.requestPresentation('Lattice', true), 'full');
  assert.deepEqual(errors, [], 'the immersive fallback is expected on older hosts and stays quiet');

  fake.impls['ui:setPanelPresentation'] = () => Promise.reject(new Error('panel-context-required'));
  assert.equal(await bridge.requestPresentation('Lattice', true), 'unchanged');
  assert.deepEqual(errors, ['ui:setPanelPresentation: panel-context-required']);

  fake.impls['ui:setPanelPresentation'] = (presentation) => Promise.resolve({ title: presentation.title, badge: null, dirty: false, attention: 'none', size: 'comfortable' });
  assert.equal(await bridge.requestPresentation('Lattice', true), 'unchanged', 'a host that silently keeps another size is reported as unchanged');
});

test('controls resolve void and report failures instead of rejecting', async () => {
  const fake = createFakeEcho();
  fake.impls['playback:play'] = () => Promise.reject(new Error('rate-limited'));
  fake.impls['queue:playTrack'] = () => Promise.reject('x'.repeat(400));
  fake.impls['ui:closePanel'] = () => { throw new TypeError('boom'); };
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  assert.equal(await bridge.play(), undefined);
  assert.equal(await bridge.pause(), undefined);
  assert.equal(await bridge.next(), undefined);
  assert.equal(await bridge.previous(), undefined);
  assert.equal(await bridge.toggleShuffle(), undefined);
  assert.equal(await bridge.setRepeat('one'), undefined);
  assert.equal(await bridge.playTrack('track-2', ['track-2', 'track-3']), undefined);
  assert.equal(await bridge.setSetting('lights-out', true), undefined);
  assert.equal(await bridge.closePanel(), undefined);
  assert.equal(await bridge.openPanel('albums'), undefined);
  assert.deepEqual(fake.of('playback:setRepeat')[0].args, ['one']);
  assert.deepEqual(fake.of('queue:playTrack')[0].args, ['track-2', ['track-2', 'track-3']]);
  assert.deepEqual(fake.of('settings:set')[0].args, ['lights-out', true]);
  assert.equal(errors.length, 3);
  assert.equal(errors[0], 'playback:play: rate-limited');
  assert.equal(errors[1].length, 160);
  assert.ok(errors[1].startsWith('queue:playTrack: xxx'));
  assert.equal(errors[2], 'ui:closePanel: boom');
});

test('onError: unsubscribe works and a throwing listener does not break reporting', async () => {
  const fake = createFakeEcho();
  fake.impls['playback:pause'] = () => Promise.reject(new Error('nope'));
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const seen = [];
  bridge.onError(() => { throw new Error('listener bug'); });
  const off = bridge.onError((message) => seen.push(message));
  await bridge.pause();
  assert.deepEqual(seen, ['playback:pause: nope']);
  off();
  await bridge.pause();
  assert.deepEqual(seen, ['playback:pause: nope']);
});

test('seek: throttles to one host call per 250 ms and always sends the trailing value', async () => {
  const timers = createFakeTimers();
  const fake = createFakeEcho(timers.now);
  const bridge = createHostBridge(fake.api, timers);
  const seeks = () => fake.of('playback:seek');

  // A drag burst: 10 values in 100 ms.
  for (let i = 0; i < 10; i += 1) {
    await bridge.seek(i);
    timers.advance(10);
  }
  assert.equal(seeks().length, 1, 'first call goes out immediately');
  assert.deepEqual(seeks()[0].args, [0]);
  timers.advance(SEEK_THROTTLE_MS);
  assert.equal(seeks().length, 2, 'trailing value is flushed when the window ends');
  assert.deepEqual(seeks()[1].args, [9]);
  assert.equal(seeks()[1].at, SEEK_THROTTLE_MS);

  // A continuous 1 s drag at 100 Hz never exceeds 4 calls per second.
  for (let i = 0; i < 100; i += 1) {
    await bridge.seek(100 + i);
    timers.advance(10);
  }
  timers.advance(SEEK_THROTTLE_MS);
  const stamps = seeks().map((entry) => entry.at);
  for (let i = 1; i < stamps.length; i += 1) {
    assert.ok(stamps[i] - stamps[i - 1] >= SEEK_THROTTLE_MS, `calls too close: ${stamps[i - 1]} -> ${stamps[i]}`);
  }
  const perSecond = stamps.filter((at) => at > 350 && at <= 1350).length;
  assert.ok(perSecond <= 4, `${perSecond} seeks in one second`);
  assert.deepEqual(seeks().at(-1).args, [199], 'last dragged value is the last one sent');
  assert.equal(timers.pending(), 0);

  // An isolated seek after a quiet period is immediate again.
  timers.advance(1_000);
  await bridge.seek(5);
  assert.deepEqual(seeks().at(-1).args, [5]);
  assert.equal(seeks().at(-1).at, timers.now());
});

test('seek: clamps negatives to zero, ignores non-finite values, and reports host failures', async () => {
  const timers = createFakeTimers();
  const fake = createFakeEcho(timers.now);
  const bridge = createHostBridge(fake.api, timers);
  const errors = collectErrors(bridge);
  await bridge.seek(-3);
  assert.deepEqual(fake.of('playback:seek')[0].args, [0]);
  timers.advance(1_000);
  await bridge.seek(Number.NaN);
  await bridge.seek(Number.POSITIVE_INFINITY);
  assert.equal(fake.of('playback:seek').length, 1);
  assert.equal(timers.pending(), 0);
  fake.impls['playback:seek'] = () => Promise.reject(new Error('invalid-payload'));
  await bridge.seek(12);
  await flush();
  assert.deepEqual(errors, ['playback:seek: invalid-payload']);
});

test('saveCamera: debounces 2 s, coalesces, rounds, and dispose cancels without flushing', async () => {
  const timers = createFakeTimers();
  const fake = createFakeEcho(timers.now);
  const bridge = createHostBridge(fake.api, timers);
  bridge.saveCamera({ x: 10.4, y: 20.6 });
  timers.advance(1_000);
  bridge.saveCamera({ x: 30.5, y: -40.4 });
  timers.advance(CAMERA_SAVE_DEBOUNCE_MS - 1);
  assert.equal(fake.of('storage:set').length, 0);
  timers.advance(1);
  assert.equal(fake.of('storage:set').length, 1);
  assert.deepEqual(fake.of('storage:set')[0].args, ['camera', { x: 31, y: -40 }]);

  bridge.saveCamera({ x: Number.NaN, y: 1 });
  assert.equal(timers.pending(), 0, 'invalid points are ignored');

  bridge.saveCamera({ x: 1, y: 1 });
  assert.equal(timers.pending(), 1);
  bridge.dispose();
  timers.advance(10_000);
  assert.equal(fake.of('storage:set').length, 1);
  bridge.saveCamera({ x: 2, y: 2 });
  await bridge.seek(3);
  assert.equal(timers.pending(), 0);
  assert.equal(fake.of('playback:seek').length, 0, 'a disposed bridge no longer talks to the host');
});

test('events: payload shape checks, handler isolation, unsubscribe and dispose', async () => {
  const fake = createFakeEcho();
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  const queues = [];
  const statuses = [];
  const contexts = [];
  const settings = [];
  bridge.onQueueChanged(() => { throw new Error('bad handler'); });
  const offQueue = bridge.onQueueChanged((payload) => queues.push(payload));
  bridge.onPlaybackStatus((payload) => statuses.push(payload));
  bridge.onContextChanged((payload) => contexts.push(payload));
  bridge.onSettingsChanged((payload) => settings.push(payload));

  fake.emit('queue:changed', snapshot(2, 0));
  fake.emit('queue:changed', { currentQueueId: null });
  fake.emit('queue:changed', null);
  fake.emit('playback:status', status());
  fake.emit('playback:status', { state: 'playing' });
  fake.emit('ui:context-changed', context());
  fake.emit('ui:context-changed', 'nope');
  fake.emit('settings:changed', { 'lights-out': false });
  fake.emit('settings:changed', 42);

  assert.equal(queues.length, 1);
  assert.equal(statuses.length, 1);
  assert.equal(contexts.length, 1);
  assert.deepEqual(settings, [{ 'lights-out': false }]);
  assert.deepEqual(errors, ['event:queue:changed: bad handler']);

  offQueue();
  fake.emit('queue:changed', snapshot(2, 0));
  assert.equal(queues.length, 1);

  bridge.dispose();
  fake.emit('playback:status', status());
  fake.emit('ui:context-changed', context());
  fake.emit('settings:changed', {});
  assert.equal(statuses.length, 1);
  assert.equal(contexts.length, 1);
  assert.equal(settings.length, 1);
  for (const [name, set] of fake.listeners) assert.equal(set.size, 0, `${name} listeners released`);
});

test('getLyrics: passes the track id through, null on failure or bad shape', async () => {
  const fake = createFakeEcho();
  const bridge = createHostBridge(fake.api, createFakeTimers());
  const errors = collectErrors(bridge);
  const lyrics = await bridge.getLyrics('track-7');
  assert.equal(lyrics.kind, 'plain');
  assert.deepEqual(fake.of('lyrics:get')[0].args, ['track-7']);
  fake.impls['lyrics:get'] = () => Promise.resolve(null);
  assert.equal(await bridge.getLyrics('track-7'), null);
  fake.impls['lyrics:get'] = () => Promise.resolve({ lines: [] });
  assert.equal(await bridge.getLyrics('track-7'), null);
  fake.impls['lyrics:get'] = () => Promise.reject(new Error('capability-denied'));
  assert.equal(await bridge.getLyrics('track-7'), null);
  assert.deepEqual(errors, ['lyrics:get: capability-denied']);
});
