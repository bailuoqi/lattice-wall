import { createServer } from 'node:http';
import vm from 'node:vm';
import { readFile, watch } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import {
  collectLyricsSceneSlots,
  eqFrequenciesHz,
  isHexColor,
  lyricsPageStyles,
  lyricsSceneSlots,
  visualizerStyles,
} from './kind-presets.mjs';
import {
  forbiddenThemeBasePresets,
  themeUiCapabilities,
} from './theme-assets.mjs';
import { createDebouncedRunner, isGeneratedWorkshopChange } from './watch-utils.mjs';
import { testNativeShell } from './native-shell.mjs';
import { animationPreviewHtml, isAnimationPreviewDefinitionValid } from './animation-preview.mjs';
import {
  assertWorkshopMockUrl,
  normalizeWorkshopNetworkHosts,
  validateWorkshopNetworkDeclaration,
} from './network-policy.mjs';
import pluginApiContract from '../contracts/plugin-api.json' with { type: 'json' };

const withTimeout = async (label, task, timeoutMs = 1_500) => Promise.race([
  Promise.resolve().then(task),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
]);

const fixtureTrack = {
  id: 'fixture-track-01', mediaType: 'local', title: 'Neon Harbor', artist: 'ECHO Fixtures',
  album: 'Local Signals', albumArtist: 'ECHO Fixtures', trackNo: 1, discNo: 1, year: 2026,
  genre: 'Electronic', codec: 'FLAC', sampleRate: 96000, bitDepth: 24, bitrate: 2800000,
  durationSeconds: 221, coverUrl: null, unavailable: false,
};

const fixtureTracks = [
  fixtureTrack,
  { ...fixtureTrack, id: 'fixture-track-02', title: 'Glass Pier', trackNo: 2, durationSeconds: 184 },
  { ...fixtureTrack, id: 'fixture-track-03', title: 'After Hours', artist: 'Harbor Lamp', album: 'Night Desk', albumArtist: 'Harbor Lamp', trackNo: 1, durationSeconds: 196 },
];

const fixtureAlbum = {
  id: 'album-1', mediaType: 'local', title: 'Local Signals', albumArtist: 'ECHO Fixtures',
  year: 2026, trackCount: 2, durationSeconds: 405, coverUrl: null,
};
const fixtureArtist = {
  id: 'artist-1', mediaType: 'local', name: 'ECHO Fixtures', role: 'both',
  trackCount: 2, albumCount: 1, coverUrl: null,
};
const fixtureGenre = {
  id: 'genre-1', mediaType: 'local', name: 'Electronic', unclassified: false,
  trackCount: 3, albumCount: 2, coverUrl: null,
};
const fixturePlaylist = {
  id: 'playlist-1', name: 'Fixture playlist', description: 'Local SDK fixture',
  kind: 'manual', itemCount: fixtureTracks.length, coverUrl: null,
};
const fixturePlaylistItems = fixtureTracks.map((track, index) => ({
  id: `playlist-item-${index + 1}`, playlistId: fixturePlaylist.id, position: index,
  unavailable: false, track,
}));
const fixtureShareTrack = {
  id: fixtureTrack.id, title: fixtureTrack.title, artist: fixtureTrack.artist, album: fixtureTrack.album,
  durationSeconds: fixtureTrack.durationSeconds, codec: fixtureTrack.codec, sizeBytes: 73_400_320,
};
const fixtureShareTask = (id = 'fixture-share-task') => ({
  id, state: 'ready', bytesSent: fixtureShareTrack.sizeBytes, totalBytes: fixtureShareTrack.sizeBytes,
  progress: 1, playbackUrl: 'https://fixture.invalid/stream', expiresAt: '2099-01-01T00:00:00.000Z',
  error: null, track: fixtureShareTrack,
});
const fixtureDirectTrack = (source = {}, index = 1) => ({
  ...fixtureTrack,
  id: `fixture-direct-${index}`,
  mediaType: 'streaming',
  title: typeof source.title === 'string' ? source.title : 'Fixture direct source',
  artist: typeof source.artist === 'string' ? source.artist : 'Workshop Direct Source',
  album: typeof source.album === 'string' ? source.album : 'Workshop Streams',
  albumArtist: typeof source.artist === 'string' ? source.artist : 'Workshop Direct Source',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  durationSeconds: 0,
  codec: 'stream',
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
});

export const createMockEcho = (packageValue, networkHosts = [], hostState = {}) => {
  const registrations = {
    commands: new Map(), agents: new Map(), sources: new Map(), lyrics: new Map(),
    metadata: new Map(), covers: new Map(), notifications: [],
    panel: {
      presentation: { title: 'Mock panel', badge: null, dirty: false, attention: 'none', size: 'comfortable' },
      closeCount: 0,
      opened: [],
    },
  };
  const permissions = new Set(Array.isArray(packageValue?.manifest?.permissions) ? packageValue.manifest.permissions : []);
  const declaredNetworkHosts = normalizeWorkshopNetworkHosts(networkHosts);
  const requireCapability = (capability) => {
    if (!permissions.has(capability)) throw new Error(`capability-denied:${capability}`);
  };
  const hostAvailability = (featureId) => {
    const definition = pluginApiContract.actions[featureId];
    if (!definition) return { supported: false, granted: false, available: false, reason: 'feature-disabled' };
    const granted = definition.permission === null || permissions.has(definition.permission);
    const override = hostState.features?.[featureId];
    if (!granted) return { supported: true, granted: false, available: false, reason: 'capability-not-approved' };
    if (override) return { supported: override.supported !== false, granted: true, available: override.available === true, reason: override.reason ?? null };
    if (hostState.proEntitled === false && featureId.startsWith('audio:dsp:')) {
      return { supported: true, granted: true, available: false, reason: 'not-entitled' };
    }
    if (hostState.audioCoreAvailable === false && (featureId.startsWith('audio:') || featureId.startsWith('playback:'))) {
      return { supported: true, granted: true, available: false, reason: 'audio-core-unavailable' };
    }
    if (hostState.currentModeCompatible === false && featureId.startsWith('audio:dsp:')) {
      return { supported: true, granted: true, available: false, reason: 'current-mode-incompatible' };
    }
    return { supported: true, granted: true, available: true, reason: null };
  };
  const guarded = (capability, handler) => (...args) => {
    requireCapability(capability);
    return handler(...args);
  };
  const eventCapabilities = {
    'playback:status': 'playback:read',
    'audio:spectrum': 'audio:spectrum',
    'queue:changed': 'queue:read',
    'library:changed': 'library:read',
    'library:liked-changed': 'library:read',
    'settings:changed': 'fs:plugin',
  };
  const emptyPage = { page: 1, pageSize: 20, total: 0, hasMore: false, items: [] };
  const storage = new Map();
  const storageKeyPattern = /^(?!__)[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  const validStorageKey = (key) => {
    if (typeof key !== 'string' || !storageKeyPattern.test(key)) throw new Error('invalid-payload');
    return key;
  };
  const dspModules = {
    equalizer: {
      enabled: false,
      preampDb: 0,
      dspHeadroomDb: -3,
      dspSafetyLimiterEnabled: true,
      bands: Array.from({ length: 31 }, (_, index) => ({ band: index, frequencyHz: 20 * (1.25 ** index), gainDb: 0, q: 1, filterType: 'peaking', enabled: true })),
      presetId: 'flat',
      presetName: 'Flat',
      clippingRisk: false,
    },
    convolution: { enabled: false, status: 'empty', irId: null, irName: null, channelMode: 'none', sampleRate: null, tapCount: 0, trimDb: 0, latencySamples: 0, clippingRisk: false },
    replayGain: { enabled: false, mode: 'track', targetLufs: -14, preampDb: 0 },
    compressor: {
      enabled: false, thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0, mix: 1,
      detectorMode: 'peak', sidechainHighpassEnabled: false, sidechainHighpassHz: 120, autoRelease: false, rangeDb: 72, stereoLink: 1,
      inputPeakDb: [-96, -96], inputRmsDb: [-96, -96], outputPeakDb: [-96, -96], outputRmsDb: [-96, -96],
      gainReductionDb: 0, gainReductionDbByChannel: [0, 0], outputHeadroomDb: 96, clippingRisk: false,
    },
    crossfeed: { enabled: false, amount: 0.25, cutoffHz: 700 },
    stereoField: { enabled: false, width: 1, centerGainDb: 0, sideGainDb: 0, clippingRisk: false },
    channelMatrix: { enabled: false, leftToLeft: 1, rightToLeft: 0, leftToRight: 0, rightToRight: 1, clippingRisk: false },
    channelBalance: {
      enabled: false, balance: 0, leftGainDb: 0, rightGainDb: 0,
      bandGains: { low: { leftGainDb: 0, rightGainDb: 0 }, mid: { leftGainDb: 0, rightGainDb: 0 }, high: { leftGainDb: 0, rightGainDb: 0 } },
      leftDelayMs: 0, rightDelayMs: 0, swapLeftRight: false, monoMode: 'off', invertLeft: false, invertRight: false, constantPower: true,
    },
    workshopAudioEffect: {
      enabled: false, effect: 'bitcrusher', bitDepth: 8, sampleRateHz: 11025, mix: 1, outputGainDb: 0,
      pulseMix: 0.8, triangleMix: 0.45, noiseMix: 0.2, drive: 2.8,
      vocalCutStrength: 1, vocalCutBassPreserveHz: 160,
    },
  };
  let dspRackOrder = ['equalizer', 'convolution', 'replayGain', 'compressor', 'crossfeed', 'stereoField', 'channelMatrix', 'channelBalance'];
  const echo = {
    host: {
      getCapabilities: async () => ({
        apiVersion: pluginApiContract.apiVersion,
        features: Object.fromEntries(Object.keys(pluginApiContract.actions).map((featureId) => [featureId, hostAvailability(featureId)])),
      }),
      getFeatureAvailability: async (featureId) => hostAvailability(featureId),
    },
    commands: {
      register: (id, definition, handler) => registrations.commands.set(id, { definition, handler }),
      execute: async (id, input) => {
        const command = registrations.commands.get(id);
        if (!command) throw new Error('command-not-registered');
        return input === undefined ? command.handler() : command.handler(input);
      },
      list: () => [...registrations.commands.entries()].map(([id, command]) => ({
        id,
        title: command.definition?.title || id,
      })),
    },
    agents: {
      register: guarded('agent:runtime', (id, definition, handler) => registrations.agents.set(id, { definition, handler })),
      run: guarded('agent:runtime', async (id, input) => registrations.agents.get(id)?.handler(input)),
    },
    sources: {
      registerProvider: guarded('sources:provide', (id, definition, handlers) => registrations.sources.set(id, { definition, handlers })),
      playDirect: guarded('sources:direct', async (source) => ({ track: fixtureDirectTrack(source) })),
      enqueueDirect: guarded('sources:direct', async (source) => ({ track: fixtureDirectTrack(source) })),
      playQueue: guarded('sources:direct', async (sources) => ({
        tracks: (Array.isArray(sources) ? sources : []).map((source, index) => fixtureDirectTrack(source, index + 1)),
      })),
      search: guarded('sources:provide', async (providerId, request) => registrations.sources.get(providerId)?.handlers.search({ query: '', page: 1, pageSize: 20, ...(request || {}) })),
      browse: guarded('sources:provide', async (providerId, request) => {
        const handlers = registrations.sources.get(providerId)?.handlers;
        if (typeof handlers?.browse === 'function') return handlers.browse(request || { page: 1, pageSize: 20 });
        return handlers?.search?.({ query: '', page: 1, pageSize: 20, ...(request || {}) });
      }),
      listCollection: guarded('sources:provide', async (providerId, collectionId, request) => (
        registrations.sources.get(providerId)?.handlers.listCollection?.({ collectionId, page: 1, pageSize: 20, ...(request || {}) })
      )),
      resolve: guarded('sources:provide', async (providerId, providerTrackId) => registrations.sources.get(providerId)?.handlers.resolve({ providerTrackId })),
    },
    lyrics: { registerProvider: guarded('lyrics:provide', (id, definition, handler) => registrations.lyrics.set(id, { definition, handler })),
      get: guarded('lyrics:read', async () => ({
        kind: 'synced',
        title: fixtureTrack.title,
        artist: fixtureTrack.artist,
        album: fixtureTrack.album,
        durationSeconds: fixtureTrack.durationSeconds,
        offsetMs: 0,
        provider: 'local',
        lines: [{ timeMs: 0, text: fixtureTrack.title, translation: null, romanization: null, kana: null, words: [] }],
        plainText: fixtureTrack.title,
        syncedText: `[00:00.00]${fixtureTrack.title}`,
      })),
    },
    metadata: { registerProvider: (id, definition, handler) => registrations.metadata.set(id, { definition, handler }) },
    covers: { registerProvider: (id, definition, handler) => registrations.covers.set(id, { definition, handler }) },
    navigation: { open: guarded('navigation', async () => null) },
    playback: {
      getStatus: guarded('playback:read', async () => ({
        state: 'playing', currentTrackId: fixtureTrack.id, positionSeconds: 42.5,
        durationSeconds: fixtureTrack.durationSeconds, volume: 0.72, shuffleEnabled: false, repeatMode: 'off',
      })),
      play: guarded('playback:control', async () => null),
      pause: guarded('playback:control', async () => null),
      seek: guarded('playback:control', async () => null),
      previous: guarded('playback:control', async () => null),
      next: guarded('playback:control', async () => null),
      setVolume: guarded('playback:control', async () => null),
      setShuffle: guarded('playback:control', async () => null),
      toggleShuffle: guarded('playback:control', async () => null),
      setRepeat: guarded('playback:control', async () => null),
      cycleRepeat: guarded('playback:control', async () => null),
      getShareInfo: guarded('playback:share', async () => ({ available: true, reason: null, track: fixtureShareTrack, allowedHosts: declaredNetworkHosts })),
      shareCurrentTrack: guarded('playback:share', async (options) => {
        assertWorkshopMockUrl(options?.uploadUrl, declaredNetworkHosts, 'share-destination-denied');
        return fixtureShareTask();
      }),
      getShareTask: guarded('playback:share', async (id) => fixtureShareTask(id)),
      playUrl: guarded('playback:share', async (url, metadata) => ({ track: fixtureDirectTrack({ ...(metadata || {}), url }) })),
    },
    audio: {
      getSpectrum: guarded('audio:spectrum', async () => ({ bands: [0.08, 0.2, 0.46, 0.72], energy: 0.48, transient: 0.2, state: 'playing' })),
      dsp: {
        getModule: guarded('audio:dsp-read', async (moduleId) => structuredClone(dspModules[moduleId])),
        setModule: guarded('audio:dsp-write', async (moduleId, state) => {
          if (!dspModules[moduleId]) throw new Error('invalid-payload');
          dspModules[moduleId] = { ...dspModules[moduleId], ...(state || {}) };
          return structuredClone(dspModules[moduleId]);
        }),
        getRackOrder: guarded('audio:dsp-read', async () => [...dspRackOrder]),
        setRackOrder: guarded('audio:dsp-write', async (order) => {
          dspRackOrder = [...order];
          return [...dspRackOrder];
        }),
      },
      offline: {
        open: guarded('audio:offline-read', async (options) => ({
          sessionId: 'fixture-offline-session',
          trackId: options?.trackId ?? fixtureTrack.id,
          title: fixtureTrack.title,
          durationSeconds: fixtureTrack.durationSeconds,
          format: { sampleRate: options?.sampleRate ?? 22050, channels: options?.channels ?? 1, sampleFormat: 's16le' },
        })),
        read: guarded('audio:offline-read', async (sessionId) => ({
          sessionId,
          dataBase64: 'AAAAAA==',
          byteLength: 4,
          frames: 2,
          eof: true,
        })),
        close: guarded('audio:offline-read', async () => null),
      },
    },
    library: {
      getSummary: guarded('library:read', async () => ({ trackCount: 1248, albumCount: 96, artistCount: 143, totalDurationSeconds: 302400 })),
      getTrack: guarded('library:read', async (trackId) => {
        const track = fixtureTracks.find((entry) => entry.id === trackId);
        if (!track) throw new Error('track-unavailable');
        return track;
      }),
      getTracks: guarded('library:read', async () => ({ page: 1, pageSize: 20, total: fixtureTracks.length, hasMore: false, items: fixtureTracks })),
      getAlbums: guarded('library:read', async () => ({ page: 1, pageSize: 12, total: 1, hasMore: false, items: [fixtureAlbum] })),
      getAlbumTracks: guarded('library:read', async () => ({ ...emptyPage, total: fixtureTracks.length, items: fixtureTracks })),
      getArtists: guarded('library:read', async () => ({ ...emptyPage, total: 1, items: [fixtureArtist] })),
      getArtistTracks: guarded('library:read', async () => ({ ...emptyPage, total: fixtureTracks.length, items: fixtureTracks })),
      getArtistAlbums: guarded('library:read', async () => ({ ...emptyPage, total: 1, items: [fixtureAlbum] })),
      getGenres: guarded('library:read', async () => ({ ...emptyPage, total: 1, items: [fixtureGenre] })),
      getGenreTracks: guarded('library:read', async () => ({ ...emptyPage, total: fixtureTracks.length, items: fixtureTracks })),
      getGenreAlbums: guarded('library:read', async () => ({ ...emptyPage, total: 1, items: [fixtureAlbum] })),
      getPlaylists: guarded('library:read', async () => [fixturePlaylist]),
      getPlaylistItems: guarded('library:read', async () => ({ ...emptyPage, total: fixturePlaylistItems.length, items: fixturePlaylistItems })),
      getLikedTracks: guarded('library:read', async () => ({ page: 1, pageSize: 20, total: 1, hasMore: false, items: [fixturePlaylistItems[0]] })),
      getLikedTrackIds: guarded('library:read', async (trackIds) => Object.fromEntries(trackIds.map((id) => [id, id === fixtureTrack.id]))),
      toggleTrackLiked: guarded('library:control', async (trackId) => ({ trackId, liked: true })),
      toggleAlbumLiked: guarded('library:control', async (albumId) => ({ albumId, liked: true })),
      createPlaylist: guarded('library:control', async (input) => ({ ...fixturePlaylist, id: 'fixture-playlist', ...input, itemCount: 0 })),
      addTracksToPlaylist: guarded('library:control', async () => fixturePlaylistItems),
    },
    queue: {
      get: guarded('queue:read', async () => ({
        currentQueueId: 'fixture-queue-1', currentTrack: fixtureTrack, canGoPrevious: false,
        canGoNext: true, shuffleEnabled: false, repeatMode: 'off',
        items: fixtureTracks.map((track, index) => ({ queueId: `fixture-queue-${index + 1}`, track })),
      })),
      playTrack: guarded('queue:control', async (trackId) => ({
        track: fixtureTracks.find((track) => track.id === trackId) ?? fixtureTrack,
      })),
      enqueueTrack: guarded('queue:control', async (trackId) => ({
        track: fixtureTracks.find((track) => track.id === trackId) ?? fixtureTrack,
      })),
      playItem: guarded('queue:control', async () => null),
      moveItem: guarded('queue:control', async () => null),
      removeItem: guarded('queue:control', async () => null),
      clear: guarded('queue:control', async () => null),
      playAlbum: guarded('queue:control', async () => ({ track: fixtureTrack, count: 2 })),
      playArtist: guarded('queue:control', async () => ({ track: fixtureTrack, count: 2 })),
      playGenre: guarded('queue:control', async () => ({ track: fixtureTrack, count: 3 })),
      playPlaylist: guarded('queue:control', async () => ({ track: fixtureTrack, count: fixtureTracks.length })),
      playLiked: guarded('queue:control', async () => ({ track: fixtureTrack, count: 1 })),
    },
    events: {
      on: (eventName) => {
        const capability = eventCapabilities[eventName];
        if (capability) requireCapability(capability);
        return () => undefined;
      },
    },
    settings: {
      get: guarded('fs:plugin', async () => ({})),
      set: guarded('fs:plugin', async () => ({})),
      onChanged: guarded('fs:plugin', () => () => undefined),
    },
    storage: {
      get: guarded('fs:plugin', async (key) => storage.get(validStorageKey(key)) ?? null),
      set: guarded('fs:plugin', async (key, value) => { storage.set(validStorageKey(key), value); return null; }),
      remove: guarded('fs:plugin', async (key) => { storage.delete(validStorageKey(key)); return null; }),
    },
    files: {
      export: guarded('fs:export', async (options) => ({
        saved: true,
        byteLength: Buffer.from(String(options?.dataBase64 ?? ''), 'base64').byteLength,
      })),
    },
    trusted: {
      invoke: guarded('system:full', async () => {
        throw new Error('The SDK mock host does not execute full-trust code; test trustedEntry in ECHO.');
      }),
    },
    network: {
      request: guarded('network:request', async (options) => {
        const url = assertWorkshopMockUrl(options?.url, declaredNetworkHosts).toString();
        return { url, status: 200, statusText: 'Fixture', ok: true, headers: {}, body: '{"tracks":[]}' };
      }),
      get: guarded('network:request', async (value) => {
        const url = assertWorkshopMockUrl(value, declaredNetworkHosts).toString();
        return { url, status: 200, statusText: 'Fixture', ok: true, headers: {}, body: '{"tracks":[]}' };
      }),
      post: guarded('network:request', async (value) => {
        const url = assertWorkshopMockUrl(value, declaredNetworkHosts).toString();
        return { url, status: 200, statusText: 'Fixture', ok: true, headers: {}, body: '{}' };
      }),
    },
    ui: {
      notify: async (message) => { registrations.notifications.push(String(message)); return null; },
      getContext: async () => ({
        surface: hostState.uiContext?.surface === 'panel' ? 'panel' : 'runtime',
        panel: hostState.uiContext?.surface === 'panel' ? { id: 'main', placement: 'main' } : null,
        visible: hostState.uiContext?.surface === 'panel' && hostState.uiContext?.visible !== false,
        locale: hostState.uiContext?.locale ?? 'en-US',
        direction: hostState.uiContext?.direction === 'rtl' ? 'rtl' : 'ltr',
        colorScheme: hostState.uiContext?.colorScheme === 'light' ? 'light' : 'dark',
        reducedMotion: hostState.uiContext?.reducedMotion === true,
        viewport: { width: 960, height: 640 },
        appearance: {
          accent: '#5cc8dc', accentText: '#08111f', panel: '#142234', text: '#c8dce8',
          heading: '#f4fbff', muted: '#8eabc0', appBg: '#08111f', border: '#2a3d52', player: '#142234',
        },
        presentation: hostState.uiContext?.surface === 'panel' ? { ...registrations.panel.presentation } : null,
      }),
      setPanelPresentation: async (value = {}) => {
        if (hostState.uiContext?.surface !== 'panel') throw new Error('panel-context-required');
        const allowedSizes = new Set(['compact', 'comfortable', 'wide', 'full', 'immersive']);
        const allowedAttention = new Set(['none', 'info', 'warning']);
        const allowedKeys = new Set(['title', 'badge', 'dirty', 'attention', 'size']);
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).some((key) => !allowedKeys.has(key))
          || (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim()))
          || (value.badge !== undefined && value.badge !== null && typeof value.badge !== 'string')
          || (value.dirty !== undefined && typeof value.dirty !== 'boolean')) throw new Error('invalid-payload');
        if (value.size !== undefined && !allowedSizes.has(value.size)) throw new Error('invalid-payload');
        if (value.attention !== undefined && !allowedAttention.has(value.attention)) throw new Error('invalid-payload');
        registrations.panel.presentation = {
          ...registrations.panel.presentation,
          ...(typeof value.title === 'string' && value.title.trim() ? { title: value.title.trim().slice(0, 80) } : {}),
          ...(value.badge === null || typeof value.badge === 'string'
            ? { badge: typeof value.badge === 'string' && value.badge.trim() ? value.badge.trim().slice(0, 16) : null }
            : {}),
          ...(typeof value.dirty === 'boolean' ? { dirty: value.dirty } : {}),
          ...(typeof value.attention === 'string' ? { attention: value.attention } : {}),
          ...(typeof value.size === 'string' ? { size: value.size } : {}),
        };
        return { ...registrations.panel.presentation };
      },
      openPanel: async (panelId) => {
        const declared = Array.isArray(packageValue?.manifest?.contributes?.panels)
          ? packageValue.manifest.contributes.panels
            .map((panel) => panel && typeof panel.id === 'string' ? panel.id : '')
            .filter(Boolean)
          : [];
        const requested = typeof panelId === 'string' ? panelId.trim() : '';
        if (panelId !== undefined && panelId !== null && panelId !== '' && !requested) throw new Error('invalid-payload');
        const id = requested || declared[0] || '';
        if (!id || (declared.length > 0 && !declared.includes(id))) throw new Error('panel-undeclared');
        if (!requested && declared.length > 1) return null;
        const title = Array.isArray(packageValue?.manifest?.contributes?.panels)
          ? (packageValue.manifest.contributes.panels.find((panel) => panel && panel.id === id)?.title ?? id)
          : id;
        registrations.panel.opened.push({ id, title });
        return { id, title };
      },
      closePanel: async () => {
        if (hostState.uiContext?.surface !== 'panel') throw new Error('panel-context-required');
        registrations.panel.closeCount += 1;
        return null;
      },
      onContextChanged: () => () => undefined,
    },
  };
  return { echo, registrations, permissions: [...permissions] };
};

export const testPluginPackage = async (packageValue, manifest = {}) => {
  const entry = packageValue.files.find((file) => file.path === packageValue.manifest.entry);
  if (!entry) throw new Error('Mock host could not find the plug-in entry file');
  const networkHosts = validateWorkshopNetworkDeclaration(manifest, packageValue);
  const { echo, registrations, permissions } = createMockEcho(packageValue, networkHosts);
  const logs = [];
  vm.runInNewContext(entry.content, {
    echo,
    console: { log: (...values) => logs.push(values.map(String).join(' ')), warn: (...values) => logs.push(values.map(String).join(' ')) },
    setTimeout,
    clearTimeout,
  }, { filename: entry.path, timeout: 1_000 });

  const checks = [];
  const run = async (kind, id, task) => {
    try {
      await withTimeout(`${kind}:${id}`, task);
      checks.push({ kind, id, ok: true });
    } catch (error) {
      checks.push({ kind, id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  for (const [id, value] of registrations.commands) await run('command', id, () => value.handler(fixtureTrack));
  for (const [id, value] of registrations.agents) await run('agent', id, () => value.handler('summarize the fixture library'));
  for (const [id, value] of registrations.sources) {
    await run('source-search', id, () => value.handlers.search({ query: '', page: 1, pageSize: 20 }));
    if (typeof value.handlers.browse === 'function') await run('source-browse', id, () => value.handlers.browse({ page: 1, pageSize: 20 }));
    if (typeof value.handlers.listCollection === 'function') {
      await run('source-collection', id, () => value.handlers.listCollection({ collectionId: 'night-desk', page: 1, pageSize: 20 }));
    }
    if (typeof value.handlers.resolve === 'function') await run('source-resolve', id, () => value.handlers.resolve({ providerTrackId: 'harbor' }));
  }
  for (const [id, value] of registrations.lyrics) await run('lyrics', id, () => value.handler({ track: fixtureTrack, query: fixtureTrack.title }));
  for (const [id, value] of registrations.metadata) await run('metadata', id, () => value.handler({ track: fixtureTrack }));
  for (const [id, value] of registrations.covers) await run('covers', id, () => value.handler({ track: fixtureTrack }));

  return {
    ok: checks.every((check) => check.ok),
    kind: 'plugin-package',
    registrations: Object.fromEntries(['commands', 'agents', 'sources', 'lyrics', 'metadata', 'covers'].map((key) => [key, registrations[key].size])),
    permissions,
    checks,
    notifications: registrations.notifications,
    logs,
  };
};

const pushCheck = (checks, id, ok, error) => {
  checks.push({ kind: 'theme', id, ok, ...(ok ? {} : { error }) });
};

export const testThemePackage = async (contentRoot, manifest, entry) => {
  const checks = [];
  pushCheck(checks, 'header', entry?.type === 'echo-workshop-theme-preset', 'theme.json must use echo-workshop-theme-preset');
  pushCheck(checks, 'base-preset', !forbiddenThemeBasePresets.includes(entry?.basePreset), 'Host-owned presets cannot be used as basePreset');
  pushCheck(checks, 'tones', Boolean(entry?.light || entry?.dark), 'At least one light or dark tone is required');

  if (typeof entry?.stylesheet === 'string' && entry.stylesheet.trim()) {
    try {
      const css = await readFile(resolve(contentRoot, ...entry.stylesheet.split('/')), 'utf8');
      pushCheck(checks, 'stylesheet-file', css.trim().length > 0, 'stylesheet file is empty');
      pushCheck(checks, 'stylesheet-safe', !/@import|javascript:|<script/iu.test(css), 'stylesheet uses a blocked construct');
      pushCheck(
        checks,
        'stylesheet-scope',
        css.includes(`data-workshop-theme-pack="${manifest.id}"`),
        `Scope CSS to html[data-workshop-theme-pack="${manifest.id}"]`,
      );
    } catch {
      pushCheck(checks, 'stylesheet-file', false, `Missing stylesheet: ${entry.stylesheet}`);
    }
  }

  if (entry?.runtime && typeof entry.runtime === 'object') {
    const allowed = new Set(themeUiCapabilities);
    const capabilities = Array.isArray(entry.runtime.capabilities) ? entry.runtime.capabilities : [];
    pushCheck(
      checks,
      'runtime-capabilities',
      capabilities.every((capability) => allowed.has(capability)) && new Set(capabilities).size === capabilities.length,
      'runtime.capabilities must stay on the host whitelist',
    );
    try {
      const html = await readFile(resolve(contentRoot, ...String(entry.runtime.entry).split('/')), 'utf8');
      pushCheck(checks, 'runtime-html', html.includes('<html') && /<script\s+src=/iu.test(html), 'runtime HTML must load an external script');
      pushCheck(checks, 'runtime-no-inline-script', !/<script(?![^>]*\bsrc=)/iu.test(html), 'Inline scripts are blocked by the production host');
    } catch {
      pushCheck(checks, 'runtime-html', false, `Missing runtime entry: ${entry.runtime.entry}`);
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    kind: 'theme',
    fixtures: ['schema', 'empty-library', 'missing-lyrics', 'playback-ended', 'provider-offline'],
    checks,
  };
};

export const testLyricsStyle = (entry) => {
  const checks = [];
  const settings = entry?.settings && typeof entry.settings === 'object' ? entry.settings : {};
  const scene = entry?.scene && typeof entry.scene === 'object' ? entry.scene : null;
  pushCheck(checks, 'header', entry?.type === 'echo-workshop-lyrics-style', 'the lyrics entry must use echo-workshop-lyrics-style');
  pushCheck(checks, 'not-empty', Boolean(scene) || Object.keys(settings).length > 0, 'settings or scene is required');
  if (settings.lyricsPageStyle) {
    pushCheck(checks, 'page-style', lyricsPageStyles.includes(settings.lyricsPageStyle), 'lyricsPageStyle is not a host layout');
  }
  if (scene) {
    const slots = collectLyricsSceneSlots(scene.root);
    const allowed = new Set(lyricsSceneSlots);
    pushCheck(checks, 'slots', slots.every((slot) => allowed.has(slot)), 'scene uses an unknown host slot');
    pushCheck(checks, 'lyrics-slot', slots.includes('lyrics') || slots.includes('current-line'), 'scene needs a lyrics or current-line slot');
    pushCheck(
      checks,
      'transport',
      scene.hostChrome?.miniPlayer !== 'hidden' || slots.includes('play-toggle'),
      'hiding the mini player requires play-toggle',
    );
  }
  return { ok: checks.every((check) => check.ok), kind: 'lyrics-style', fixtures: ['schema', 'missing-lyrics', 'playback-ended'], checks };
};

export const testVisualizerPreset = (entry) => {
  const checks = [];
  const palette = Array.isArray(entry?.palette) ? entry.palette : [];
  pushCheck(checks, 'header', entry?.type === 'echo-workshop-visualizer-preset', 'visualizer.json must use echo-workshop-visualizer-preset');
  pushCheck(checks, 'style', visualizerStyles.includes(entry?.style), 'style must be bars, wave or radial');
  pushCheck(
    checks,
    'palette',
    palette.length >= 1 && palette.length <= 8 && new Set(palette.map((value) => String(value).toLowerCase())).size === palette.length && palette.every(isHexColor),
    'palette must be 1-8 unique hex colors',
  );
  pushCheck(checks, 'bar-count', Number.isInteger(entry?.barCount) && entry.barCount >= 8 && entry.barCount <= 128, 'barCount must be 8-128');
  return { ok: checks.every((check) => check.ok), kind: 'visualizer-preset', fixtures: ['schema', 'empty-library'], checks };
};

export const testDspPreset = (entry) => {
  const checks = [];
  const bands = Array.isArray(entry?.bands) ? entry.bands : [];
  pushCheck(checks, 'header', entry?.type === 'echo-workshop-dsp-preset', 'the DSP entry must use echo-workshop-dsp-preset');
  pushCheck(checks, 'band-count', bands.length === eqFrequenciesHz.length, `DSP presets need ${eqFrequenciesHz.length} bands`);
  pushCheck(
    checks,
    'preamp',
    typeof entry?.preampDb === 'number' && entry.preampDb >= -12 && entry.preampDb <= 6,
    'preampDb must be -12 to 6',
  );
  if (entry?.audioEffect !== undefined) {
    const effect = entry.audioEffect;
    pushCheck(checks, 'audio-effect-type', effect?.type === 'bitcrusher' || effect?.type === 'chiptune', 'audioEffect.type must be bitcrusher or chiptune');
    pushCheck(checks, 'audio-effect-bit-depth', Number.isInteger(effect?.bitDepth) && effect.bitDepth >= 4 && effect.bitDepth <= 16, 'bitDepth must be 4-16');
    pushCheck(checks, 'audio-effect-sample-rate', Number.isInteger(effect?.sampleRateHz) && effect.sampleRateHz >= 1000 && effect.sampleRateHz <= 192000, 'sampleRateHz must be 1000-192000');
    pushCheck(checks, 'audio-effect-mix', typeof effect?.mix === 'number' && effect.mix >= 0 && effect.mix <= 1, 'mix must be 0-1');
    pushCheck(checks, 'audio-effect-output-gain', effect?.outputGainDb === undefined || (typeof effect.outputGainDb === 'number' && effect.outputGainDb >= -24 && effect.outputGainDb <= 6), 'outputGainDb must be -24 to 6');
    if (effect?.type === 'chiptune') {
      pushCheck(checks, 'audio-effect-pulse', typeof effect.pulseMix === 'number' && effect.pulseMix >= 0 && effect.pulseMix <= 1, 'pulseMix must be 0-1');
      pushCheck(checks, 'audio-effect-triangle', typeof effect.triangleMix === 'number' && effect.triangleMix >= 0 && effect.triangleMix <= 1, 'triangleMix must be 0-1');
      pushCheck(checks, 'audio-effect-noise', typeof effect.noiseMix === 'number' && effect.noiseMix >= 0 && effect.noiseMix <= 1, 'noiseMix must be 0-1');
      pushCheck(checks, 'audio-effect-layers', effect.pulseMix + effect.triangleMix + effect.noiseMix > 0, 'at least one chiptune layer must be audible');
      pushCheck(checks, 'audio-effect-drive', typeof effect.drive === 'number' && effect.drive >= 1 && effect.drive <= 8, 'drive must be 1-8');
    }
  }
  return { ok: checks.every((check) => check.ok), kind: 'dsp-preset', fixtures: ['schema'], checks };
};

export const testLocalePack = (entry) => {
  const checks = [];
  const builtin = new Set(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR']);
  const strings = entry?.strings && typeof entry.strings === 'object' && !Array.isArray(entry.strings)
    ? entry.strings
    : {};
  pushCheck(checks, 'header', entry?.type === 'echo-workshop-locale-pack', 'locale.json must use echo-workshop-locale-pack');
  pushCheck(
    checks,
    'locale',
    typeof entry?.locale === 'string' && /^[a-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/u.test(entry.locale) && !builtin.has(entry.locale),
    'locale must be a new BCP-47 code, not a built-in ECHO language',
  );
  pushCheck(checks, 'strings', Object.keys(strings).length >= 1, 'locale packs need at least one translation string');
  return { ok: checks.every((check) => check.ok), kind: 'locale-pack', fixtures: ['schema'], checks };
};

export const testAnimationLibrary = (entry) => {
  const checks = [];
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  pushCheck(checks, 'header', entry?.type === 'echo-workshop-animation-library' && entry?.schemaVersion === 1, 'animation-library.json must use the v1 animation-library header');
  pushCheck(checks, 'animation-count', animations.length >= 1 && animations.length <= 64, 'animation libraries need 1-64 exports');
  pushCheck(checks, 'keyframes', animations.every((animation) => {
    const frames = Array.isArray(animation?.keyframes) ? animation.keyframes : [];
    return frames.length >= 2 && frames.length <= 8 && frames[0]?.offset === 0 && frames.at(-1)?.offset === 1;
  }), 'every animation needs 2-8 keyframes spanning offsets 0 to 1');
  pushCheck(checks, 'definition-contract', animations.every(isAnimationPreviewDefinitionValid), 'animation exports must use only bounded host-supported fields');
  return { ok: checks.every((check) => check.ok), kind: 'animation-library', fixtures: ['schema', 'missing-dependency'], checks };
};

export const testWorkshopItem = async ({ kind, contentRoot, manifest, entry }) => {
  if (kind === 'plugin-package') return testPluginPackage(entry, manifest);
  if (kind === 'theme') return testThemePackage(contentRoot, manifest, entry);
  if (kind === 'lyrics-style') return testLyricsStyle(entry);
  if (kind === 'animation-library') return testAnimationLibrary(entry);
  if (kind === 'visualizer-preset') return testVisualizerPreset(entry);
  if (kind === 'dsp-preset') return testDspPreset(entry);
  if (kind === 'locale-pack') return testLocalePack(entry);
  if (kind === 'native-shell') return testNativeShell(entry);
  return {
    ok: true,
    kind,
    fixtures: ['schema', 'empty-library', 'missing-lyrics', 'playback-ended', 'provider-offline'],
  };
};

const mimeByExtension = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const consoleHtml = (hasPreview) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>ECHO Workshop SDK Console</title>
  <style>
    :root{color-scheme:dark;--bg:#090d13;--panel:#111923;--panel2:#172230;--line:#27384a;--text:#eef7ff;--muted:#8da3b8;--accent:#67d4ff;--good:#78e6ad;--warn:#f3c66c;--bad:#ff8f9b}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0,#123047 0,transparent 34%),var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
    button,a{font:inherit}.shell{width:min(1180px,calc(100% - 32px));margin:auto;padding:24px 0 48px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:42px}.brand{display:flex;align-items:center;gap:11px;font-weight:760;letter-spacing:.08em}.mark{width:28px;height:28px;display:grid;place-items:center;background:var(--accent);color:#071018;font-weight:900}.actions{display:flex;gap:10px;align-items:center}.action{display:inline-flex;align-items:center;min-height:36px;padding:0 13px;border:1px solid var(--line);color:var(--text);text-decoration:none;background:#101923;cursor:pointer}.action:hover{border-color:var(--accent)}.live{display:flex;gap:8px;align-items:center;color:var(--muted)}.live::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 14px var(--good)}
    .hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;margin-bottom:24px}.eyebrow{margin:0 0 8px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.hero h1{margin:0;font-size:clamp(30px,5vw,56px);line-height:1.02;letter-spacing:-.045em}.meta{margin:12px 0 0;color:var(--muted);font-size:15px}.verdict{min-width:190px;padding:18px 20px;background:var(--panel);border-left:4px solid var(--good)}.verdict.bad{border-color:var(--bad)}.verdict span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.12em}.verdict strong{font-size:22px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}.metric,.panel{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line)}.metric{padding:17px}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;margin-top:5px;font-size:24px}.metric.good strong{color:var(--good)}.metric.warn strong{color:var(--warn)}.metric.bad strong{color:var(--bad)}
    .content{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:12px}.panel{padding:20px}.panel h2{margin:0 0 15px;font-size:15px;letter-spacing:.02em}.stack{display:grid;gap:9px}.row{display:grid;grid-template-columns:82px 1fr;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}.label{color:var(--muted)}.chips{display:flex;flex-wrap:wrap;gap:7px}.chip{padding:4px 8px;background:var(--panel2);color:#cfe6f6;border:1px solid var(--line);font-size:12px}.checks{display:grid;gap:8px}.check{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:10px 12px;background:var(--panel2)}.check i{width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--good)}.check.warning i{background:var(--warn)}.check.bad i{background:var(--bad)}.check small{display:block;color:var(--muted)}.empty{color:var(--muted);padding:18px 0}.foot{margin-top:16px;color:var(--muted);font-size:12px}.raw{width:100%;margin-top:14px;padding:10px 12px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}.raw:hover{color:var(--text);border-color:var(--accent)}pre{max-height:360px;overflow:auto;margin:10px 0 0;padding:12px;background:#080c11;color:#b8d2e5;white-space:pre-wrap}.hidden{display:none}
    @media(max-width:820px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}.content{grid-template-columns:1fr}.verdict{min-width:0}}@media(max-width:480px){.shell{width:min(100% - 20px,1180px)}.topbar{align-items:flex-start}.actions{flex-direction:column;align-items:flex-end}.grid{grid-template-columns:1fr 1fr}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar"><div class="brand"><span class="mark">E</span><span>WORKSHOP SDK</span></div><div class="actions"><button class="action" id="copy-check" type="button">Copy check</button><button class="action" id="copy-fix" type="button">Copy fix</button>${hasPreview ? '<a class="action" href="/" target="_blank">Open preview</a>' : ''}<span class="live" id="live">Watching</span></div></header>
    <section class="hero"><div><p class="eyebrow">Local author console</p><h1 id="title">Loading project…</h1><p class="meta" id="meta">Reading the latest fixture report</p></div><div class="verdict" id="verdict"><span>Current gate</span><strong id="verdict-copy">Checking</strong></div></section>
    <section class="grid"><article class="metric good"><span>Passed</span><strong id="pass">0</strong></article><article class="metric warn"><span>Warnings</span><strong id="warning">0</strong></article><article class="metric bad"><span>Blockers</span><strong id="blocker">0</strong></article><article class="metric"><span>Fixture checks</span><strong id="fixture-count">0</strong></article></section>
    <section class="content"><article class="panel"><h2>Validation stream</h2><div class="checks" id="checks"></div><p class="empty" id="empty">No checks reported yet.</p></article><aside class="panel"><h2>Project contract</h2><div class="stack"><div class="row"><span class="label">Kind</span><strong id="kind">—</strong></div><div class="row"><span class="label">Version</span><strong id="version">—</strong></div><div class="row"><span class="label">Minimum</span><strong id="minimum">—</strong></div><div class="row"><span class="label">Changed</span><strong id="changed">Initial run</strong></div><div class="row"><span class="label">Permissions</span><div class="chips" id="permissions"></div></div><div class="row"><span class="label">Fixtures</span><div class="chips" id="fixtures"></div></div></div><button class="raw" id="raw-toggle" type="button">Show raw report</button><pre class="hidden" id="raw"></pre><p class="foot" id="updated">Waiting for first refresh.</p></aside></section>
  </main>
  <script>
    const byId=(id)=>document.getElementById(id);const set=(id,value)=>{byId(id).textContent=String(value??'—')};
    const chips=(id,values)=>{const node=byId(id);node.replaceChildren();for(const value of values||[]){const chip=document.createElement('span');chip.className='chip';chip.textContent=String(value);node.append(chip)}if(!node.childNodes.length){const empty=document.createElement('span');empty.className='label';empty.textContent='None';node.append(empty)}};
    const render=async()=>{try{const report=await fetch('/report.json',{cache:'no-store'}).then((response)=>response.json());const quality=report.quality||{summary:{pass:0,warning:0,blocker:0},issues:[]};const tests=report.tests||report;const checks=[...(report.error?[{ok:false,name:'project-error',detail:report.error,state:'blocker'}]:[]),...(quality.issues||[]).map((item)=>({ok:item.severity!=='blocker',name:item.code,detail:item.message,state:item.severity})),...(tests.checks||[]).map((item)=>({ok:item.ok,name:(item.kind?item.kind+':':'')+item.id,detail:item.error||'Fixture passed',state:item.ok?'pass':'blocker'}))];set('title',report.title||report.id||'Workshop project');set('meta',(report.id||'local project')+' · '+(report.files??0)+' packaged file(s)');set('kind',report.kind);set('version',report.version);set('minimum',report.minEchoVersion);set('changed',report.changedFile||'Initial run');set('pass',quality.summary?.pass??0);set('warning',quality.summary?.warning??0);set('blocker',quality.summary?.blocker??0);set('fixture-count',(tests.checks||[]).length);set('verdict-copy',report.ok?'Ready locally':'Needs attention');byId('verdict').classList.toggle('bad',!report.ok);chips('permissions',report.permissions||tests.permissions||[]);chips('fixtures',tests.fixtures||[]);const list=byId('checks');list.replaceChildren();for(const item of checks){const row=document.createElement('div');row.className='check '+(item.state==='warning'?'warning':item.ok?'pass':'bad');const dot=document.createElement('i');const copy=document.createElement('div');const name=document.createElement('strong');const detail=document.createElement('small');name.textContent=item.name;detail.textContent=item.detail;copy.append(name,detail);row.append(dot,copy);list.append(row)}byId('empty').classList.toggle('hidden',checks.length>0);byId('raw').textContent=JSON.stringify(report,null,2);set('updated','Updated '+new Date().toLocaleTimeString()+' · local fixtures only; no Steam upload.');set('live','Watching')}catch(error){set('live','Disconnected');set('verdict-copy','Console offline');byId('verdict').classList.add('bad')}};
    const copyCommand=async(button,command)=>{try{await navigator.clipboard.writeText(command);const previous=button.textContent;button.textContent='Copied';setTimeout(()=>{button.textContent=previous},1200)}catch{button.textContent=command}};byId('copy-check').addEventListener('click',(event)=>copyCommand(event.currentTarget,'npm run check'));byId('copy-fix').addEventListener('click',(event)=>copyCommand(event.currentTarget,'npm run fix'));byId('raw-toggle').addEventListener('click',()=>{const raw=byId('raw');raw.classList.toggle('hidden');byId('raw-toggle').textContent=raw.classList.contains('hidden')?'Show raw report':'Hide raw report'});new EventSource('/events').onmessage=render;render();
  </script>
</body>
</html>`;

const fixtureLyrics = [
  'Harbor lamps lean over the water',
  'Glass pier keeps the tempo',
  'Neon writes the chorus twice',
];

const renderScenePreview = (node) => {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'slot') {
    const copy = {
      cover: '▣',
      title: fixtureTrack.title,
      artist: fixtureTrack.artist,
      album: fixtureTrack.album,
      lyrics: fixtureLyrics.join('\n'),
      'current-line': fixtureLyrics[1],
      'previous-line': fixtureLyrics[0],
      'next-line': fixtureLyrics[2],
      translation: 'Local fixture translation',
      progress: '1:12 / 3:41',
      'seek-bar': '━━━━●━━',
      'time-current': '1:12',
      'time-duration': '3:41',
      spectrum: '▮▮▯▮▮',
      status: 'playing',
      'track-tech': 'FLAC 96 kHz',
      'play-toggle': '❚❚',
      'previous-track': '⏮',
      'next-track': '⏭',
      'volume-slider': '🔊',
    }[node.slot] ?? node.slot;
    return `<div class="slot" data-slot="${node.slot}">${String(copy).replaceAll('\n', '<br>')}</div>`;
  }
  if (node.type === 'group') {
    const children = Array.isArray(node.children) ? node.children.map(renderScenePreview).join('') : '';
    return `<div class="group">${children}</div>`;
  }
  if (node.type === 'text') return `<p>${String(node.text ?? '')}</p>`;
  return '';
};

const lyricsPreviewHtml = (entry) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>ECHO lyrics scene preview</title>
  <style>
    body{margin:0;min-height:100vh;font:15px system-ui;background:#10131a;color:#eaf4ff}
    .note{padding:10px 16px;background:#151f2d;color:#9db3c7}
    .stage{min-height:calc(100vh - 42px);padding:28px;display:grid;gap:16px}
    .group{display:grid;gap:12px}
    .slot{padding:12px 14px;border-radius:14px;background:#182231;border:1px solid #30465a;white-space:pre-wrap}
    .slot[data-slot="cover"]{width:min(220px,40vw);aspect-ratio:1;display:grid;place-items:center;font-size:48px}
  </style>
</head>
<body>
  <p class="note">Local lyrics fixture. Slots are host-owned; this page is not the production lyrics renderer.</p>
  <div class="stage">${entry?.scene ? renderScenePreview(entry.scene.root) : '<p>Settings-only lyrics style. The host keeps its built-in layout.</p>'}</div>
</body>
</html>`;

const visualizerPreviewHtml = (entry) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>ECHO visualizer preview</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1017;color:#eaf4ff;font:14px system-ui}
    .note{position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#151f2d;color:#9db3c7}
    .bars,.wave,.radial{display:flex;align-items:flex-end;gap:4px;height:220px}
    .radial{align-items:center;justify-content:center;width:260px;height:260px;border-radius:50%;border:2px solid #31445b}
    i{display:block;width:8px;border-radius:99px;animation:pulse 1.2s ease-in-out infinite alternate}
    @keyframes pulse{from{opacity:.45}to{opacity:1}}
  </style>
</head>
<body>
  <p class="note">Local spectrum fixture for ${entry?.style ?? 'bars'}. Audio Core still owns the real analyzer.</p>
  <div class="${entry?.style === 'radial' ? 'radial' : entry?.style === 'wave' ? 'wave' : 'bars'}">
    ${Array.from({ length: Math.min(Number(entry?.barCount) || 24, 48) }, (_, index) => {
      const color = Array.isArray(entry?.palette) ? entry.palette[index % entry.palette.length] : '#66ccff';
      const height = 24 + ((index * 17) % 160);
      return `<i style="height:${height}px;background:${color}"></i>`;
    }).join('')}
  </div>
</body>
</html>`;

const dspPreviewHtml = (entry) => {
  const bands = Array.isArray(entry?.bands) ? entry.bands : [];
  const points = bands.map((band, index) => {
    const x = bands.length <= 1 ? 20 : 20 + (index / (bands.length - 1)) * 760;
    const y = 110 - Math.max(-12, Math.min(12, Number(band.gainDb) || 0)) * 7;
    return `${x},${y}`;
  }).join(' ');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>ECHO DSP preview</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1420;color:#eaf4ff;font:14px system-ui}
    .note{position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#151f2d;color:#9db3c7}
    svg{width:min(820px,92vw);height:auto}
  </style>
</head>
<body>
  <p class="note">Local EQ curve. Native host / Audio Core still owns playback DSP.</p>
  <svg viewBox="0 0 800 220" role="img" aria-label="EQ curve">
    <rect width="800" height="220" fill="#151f2d" rx="16"/>
    <polyline fill="none" stroke="#66ccff" stroke-width="3" points="${points}"/>
    <text x="24" y="28" fill="#9db3c7">preamp ${entry?.preampDb ?? 0} dB · ${bands.length} bands</text>
  </svg>
</body>
</html>`;
}

const stylesheetPreviewHtml = (packId) => `<!doctype html>
<html data-theme-preset="workshopStylesheet" data-workshop-theme-pack="${packId}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>ECHO stylesheet preview</title>
  <link rel="stylesheet" href="/theme.css">
  <style>
    body{margin:0;min-height:100vh;font:15px system-ui}
    .app-shell{min-height:100vh;display:grid;grid-template-rows:48px 1fr 84px;grid-template-columns:220px 1fr}
    .app-titlebar{grid-column:1/-1;display:flex;align-items:center;padding:0 16px}
    .sidebar{padding:16px}
    .page-surface{padding:24px}
    .player-bar{grid-column:1/-1;display:flex;align-items:center;padding:0 20px}
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-titlebar">Stylesheet preview · ${packId}</header>
    <aside class="sidebar">Library<br>Queue<br>Lyrics</aside>
    <main class="page-surface">
      <h1>Local chrome mock</h1>
      <p>This page applies your packaged CSS to host class names. It is not the production sandbox.</p>
    </main>
    <footer class="player-bar">Now playing · fixture track</footer>
  </div>
</body>
</html>`;

const runtimePreviewHtml = () => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>ECHO UI runtime preview</title>
  <style>
    html,body{margin:0;height:100%;background:#0b1017;color:#eaf4ff;font:14px system-ui}
    .wrap{height:100%;display:grid;grid-template-rows:1fr auto}
    iframe{width:100%;height:100%;border:0;background:#0000}
    .note{padding:8px 14px;background:#151f2d;color:#9db3c7}
  </style>
</head>
<body>
  <div class="wrap">
    <iframe id="frame" sandbox="allow-scripts" src="/ui/index.html" title="Workshop UI runtime"></iframe>
    <p class="note">Local fixture host. Playback, library and queue replies are fake and never read your real library.</p>
  </div>
  <script>
    const frame = document.getElementById('frame');
    const state = {
      playback: { state: 'paused', currentTrackId: 'fixture-track-01', positionSeconds: 12, durationSeconds: 221, volume: 0.8 },
      currentTrack: ${JSON.stringify(fixtureTrack)},
      queue: { currentQueueId: 'q1', canGoPrevious: false, canGoNext: true, items: [{ queueId: 'q1', track: ${JSON.stringify(fixtureTrack)} }] },
    };
    const reply = (source, requestId, ok, value, error) => source.postMessage({
      type: 'echo:workshop-ui:result', protocolVersion: 1, requestId, ok, ...(value !== undefined ? { value } : {}), ...(error ? { error } : {}),
    }, '*');
    const sendState = (source) => source.postMessage({ type: 'echo:workshop-ui:state', protocolVersion: 1, ...state }, '*');
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || event.source !== frame.contentWindow) return;
      if (data.type === 'echo:workshop-ui:ready') {
        event.source.postMessage({
          type: 'echo:workshop-ui:init', protocolVersion: 1, theme: { id: 'local-preview', version: 'dev' },
          capabilities: ${JSON.stringify(themeUiCapabilities)},
          appearance: { accent: '#7ad4ff', accentText: '#7ad4ff', panel: '#121b26', text: '#f4fbff', heading: '#f4fbff', muted: '#8eabc0', appBg: '#0c1219', border: '#2a3d52', player: '#121b26' },
        }, '*');
        sendState(event.source);
        return;
      }
      if (data.type !== 'echo:workshop-ui:command') return;
      const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
      if (data.command === 'library:listTracks') {
        const search = String(payload.search || '').toLowerCase();
        const items = ${JSON.stringify(fixtureTracks)}.filter((track) => !search || track.title.toLowerCase().includes(search) || track.artist.toLowerCase().includes(search));
        reply(event.source, data.requestId, true, { page: 1, pageSize: 40, total: items.length, hasMore: false, items });
        return;
      }
      if (data.command === 'play' || data.command === 'playPause') state.playback.state = state.playback.state === 'playing' ? 'paused' : 'playing';
      if (data.command === 'pause') state.playback.state = 'paused';
      if (data.command === 'queue:playTrack') {
        const track = ${JSON.stringify(fixtureTracks)}.find((item) => item.id === payload.trackId) || ${JSON.stringify(fixtureTrack)};
        state.currentTrack = track;
        state.playback.currentTrackId = track.id;
        state.playback.state = 'playing';
      }
      reply(event.source, data.requestId, true, null);
      sendState(event.source);
    });
  </script>
</body>
</html>`;

const safeContentPath = (contentRoot, relativePath) => {
  if (!relativePath || relativePath.includes('\\') || isAbsolute(relativePath)) return null;
  const absolute = resolve(contentRoot, ...relativePath.split('/'));
  const fromRoot = relative(contentRoot, absolute);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null;
  return absolute;
};

const send = (response, status, contentType, body) => {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(body);
};

const listenOnFreePort = async (server, preferredPort, allowFallback) => {
  const attempts = allowFallback ? 20 : 1;
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) break;
    try {
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(candidate, '127.0.0.1', () => {
          server.removeListener('error', rejectListen);
          resolveListen();
        });
      });
      return candidate;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  if (!allowFallback) throw new Error(`Port ${preferredPort} is busy. Pass a different --port or omit it to auto-pick a free one.`);
  throw new Error(`No free local port between ${preferredPort} and ${Math.min(preferredPort + attempts - 1, 65535)}. Pass --port to choose another.`);
};

export const startMockHost = async ({ root, port, portIsExplicit = false, runTests, watchPath, contentRoot, kind, stylesheet, runtimeEntry, packId, entry }) => {
  let report = await runTests();
  let currentEntry = report.entry ?? entry;
  const hasPreview = (kind === 'theme' && Boolean(runtimeEntry || stylesheet))
    || kind === 'lyrics-style'
    || kind === 'animation-library'
    || kind === 'visualizer-preset'
    || kind === 'dsp-preset';
  const clients = new Set();
  const server = createServer(async (request, response) => {
    const url = request.url ?? '/';
    if (url === '/report.json') {
      const { entry: _entry, ...publicReport } = report;
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(publicReport, null, 2));
      return;
    }
    if (url === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (url === '/theme.css' && stylesheet && contentRoot) {
      try {
        send(response, 200, 'text/css; charset=utf-8', await readFile(resolve(contentRoot, ...stylesheet.split('/')), 'utf8'));
      } catch {
        send(response, 404, 'text/plain; charset=utf-8', 'stylesheet missing');
      }
      return;
    }
    if (url.startsWith('/ui/') && contentRoot) {
      const absolute = safeContentPath(contentRoot, `ui/${url.slice(4)}`);
      if (!absolute) {
        send(response, 404, 'text/plain; charset=utf-8', 'not found');
        return;
      }
      try {
        const body = await readFile(absolute);
        send(response, 200, mimeByExtension[extname(absolute).toLowerCase()] ?? 'application/octet-stream', body);
      } catch {
        send(response, 404, 'text/plain; charset=utf-8', 'not found');
      }
      return;
    }
    if (url === '/console' || url === '/console/') {
      send(response, 200, 'text/html; charset=utf-8', consoleHtml(hasPreview));
      return;
    }
    if (url === '/' || url === '/index.html') {
      if (kind === 'theme' && runtimeEntry) {
        send(response, 200, 'text/html; charset=utf-8', runtimePreviewHtml());
        return;
      }
      if (kind === 'theme' && stylesheet) {
        send(response, 200, 'text/html; charset=utf-8', stylesheetPreviewHtml(packId ?? 'workshop-theme'));
        return;
      }
      if (kind === 'lyrics-style') {
        send(response, 200, 'text/html; charset=utf-8', lyricsPreviewHtml(currentEntry));
        return;
      }
      if (kind === 'animation-library') {
        send(response, 200, 'text/html; charset=utf-8', animationPreviewHtml(currentEntry));
        return;
      }
      if (kind === 'visualizer-preset') {
        send(response, 200, 'text/html; charset=utf-8', visualizerPreviewHtml(currentEntry));
        return;
      }
      if (kind === 'dsp-preset') {
        send(response, 200, 'text/html; charset=utf-8', dspPreviewHtml(currentEntry));
        return;
      }
      send(response, 200, 'text/html; charset=utf-8', consoleHtml(false));
      return;
    }
    send(response, 404, 'text/plain; charset=utf-8', 'not found');
  });
  const boundPort = await listenOnFreePort(server, port, !portIsExplicit);
  const watcher = watch(resolve(root, watchPath), { recursive: true });
  const runner = createDebouncedRunner({
    run: async (changedFile) => {
      const nextReport = await runTests();
      report = { ...nextReport, changedFile };
      if (report.entry) currentEntry = report.entry;
      for (const client of clients) client.write(`data: reload\n\n`);
    },
    onError: (error, changedFile) => {
      report = { ok: false, changedFile, error: error instanceof Error ? error.message : String(error) };
      for (const client of clients) client.write(`data: reload\n\n`);
    },
  });
  void (async () => {
    for await (const event of watcher) {
      if (isGeneratedWorkshopChange(event.filename)) continue;
      runner.schedule(event.filename);
    }
    runner.dispose();
  })();
  return {
    server,
    watcher,
    port: boundPort,
    requestedPort: port,
    url: `http://127.0.0.1:${boundPort}`,
    consoleUrl: `http://127.0.0.1:${boundPort}${hasPreview ? '/console' : ''}`,
    previewUrl: hasPreview ? `http://127.0.0.1:${boundPort}/` : null,
  };
};
