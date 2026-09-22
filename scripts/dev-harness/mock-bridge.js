// Mock of the host-injected `__bridge__.js` for the local dev harness. Classic script: it runs inside
// the sandboxed panel iframe and defines the same frozen `echo` global (the subset Lattice Wall uses),
// backed by deterministic in-memory fixtures selected with `?fixture=<name>`.
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const fixtureName = params.get('fixture') || 'playing';
  const LATENCY_MS = 12;
  const QUEUE_CAP = 500;
  const RATE_LIMIT_PER_SECOND = 20;
  const STORAGE_VALUE_LIMIT = 16 * 1024;
  const PANEL_TITLE = 'Lattice · 曲库拼贴墙';

  // ---------------------------------------------------------------------------------------------
  // Deterministic generation
  // ---------------------------------------------------------------------------------------------

  const mulberry32 = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

  const TITLE_HEADS = ['夜航', '回声', '格子', '光年', '潮汐', '午后', '信号', '边界', '远方', '静电', 'Slow Grid', 'Paper Moon', 'Half Light', 'North Window'];
  const TITLE_TAILS = ['之间', '练习曲', '备忘', '第二章', '慢板', '重奏', '素描', '副歌', '独白', '尾声', '(Live)', 'Reprise', 'Demo'];
  const ARTISTS = ['Lattice Ensemble', '回声工作室', 'Moiré', '零点四', 'Paper Signals', '林间电台', 'Antenna Club', '未命名乐队', 'Ada Ferry', '雾岛'];
  const ALBUM_HEADS = ['墙', '夜间频道', '拼贴', 'Grid Sessions', '缓存', 'Static Bloom', '回廊', 'Late Signals'];
  const LYRIC_LINES = [
    ['光在墙上慢慢流动', 'Light drifts slowly across the wall'],
    ['每一张封面都是一扇窗', 'Every cover is a window'],
    ['队列像潮水一样往前推', 'The queue rolls forward like a tide'],
    ['我们在格子之间迷路', 'We lose our way between the cells'],
    ['Hold the line until the chorus comes', '撑住这一句 直到副歌来临'],
    ['把这一首歌留到天亮', 'Keep this song until the morning'],
    ['回声从角落里返回', 'An echo returns from the corner'],
    ['数字在角上安静发亮', 'Numbers glow quietly in the corner'],
    ['Count the covers one by one', '把封面一张一张数过'],
    ['风把节拍吹得更远', 'The wind carries the beat further'],
    ['按下播放 世界慢半拍', 'Press play and the world slows half a beat'],
    ['声音沿着网格散开', 'The sound spreads along the grid'],
    ['下一首在远处等着', 'The next one waits in the distance'],
    ['让灯熄灭 只剩封面', 'Lights out, only the covers remain'],
    ['Nothing here is out of reach', '这里没有到不了的地方'],
    ['我们把夜晚拼成一面墙', 'We tile the night into a wall'],
  ];

  const hsl = (h, s, l) => `hsl(${h}, ${s}%, ${l}%)`;
  const coverFor = (index, rnd) => {
    const h1 = Math.floor(rnd() * 360);
    const h2 = (h1 + 40 + Math.floor(rnd() * 140)) % 360;
    const cx = 60 + Math.floor(rnd() * 136);
    const cy = 60 + Math.floor(rnd() * 136);
    const r = 40 + Math.floor(rnd() * 70);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + `<stop offset="0" stop-color="${hsl(h1, 62, 48)}"/><stop offset="1" stop-color="${hsl(h2, 70, 28)}"/>`
      + '</linearGradient></defs><rect width="256" height="256" fill="url(#g)"/>'
      + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hsl(h2, 80, 72)}" fill-opacity="0.35"/>`
      + `<text x="20" y="232" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="rgba(255,255,255,0.85)">${String(index + 1).padStart(2, '0')}</text>`
      + '</svg>';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const makeItems = (count, coverlessShare) => {
    const rnd = mulberry32(0x1a77 + count);
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const longTitle = i % 9 === 8;
      const title = longTitle
        ? `${pick(rnd, TITLE_HEADS)} ${pick(rnd, TITLE_TAILS)} — ${pick(rnd, TITLE_HEADS)}${pick(rnd, TITLE_TAILS)} ${pick(rnd, TITLE_TAILS)}`
        : `${pick(rnd, TITLE_HEADS)}${rnd() < 0.5 ? '' : ' '}${pick(rnd, TITLE_TAILS)}`;
      const artist = pick(rnd, ARTISTS);
      const coverless = (i * 7) % 10 < Math.round(coverlessShare * 10);
      items.push({
        queueId: `mock-queue-${i}`,
        track: {
          id: `mock-track-${i}`,
          mediaType: 'local',
          title,
          artist,
          album: `${pick(rnd, ALBUM_HEADS)} ${2015 + Math.floor(rnd() * 11)}`,
          albumArtist: artist,
          trackNo: (i % 12) + 1,
          discNo: 1,
          year: 2015 + Math.floor(rnd() * 11),
          genre: null,
          durationSeconds: 150 + Math.floor(rnd() * 270),
          codec: 'flac',
          sampleRate: 44100,
          bitDepth: 16,
          bitrate: null,
          coverUrl: coverless ? null : coverFor(i, rnd),
          unavailable: false,
        },
      });
    }
    return items;
  };

  const splitWords = (text, startMs, endMs, dropLastEnd) => {
    const tokens = text.includes(' ') ? text.split(' ').filter(Boolean) : text.match(/[\s\S]{1,2}/g) || [text];
    const per = (endMs - startMs) / tokens.length;
    return tokens.map((token, i) => {
      const wordStart = Math.round(startMs + i * per);
      const last = i === tokens.length - 1;
      return { text: token, startMs: wordStart, endMs: last && dropLastEnd ? null : Math.round(wordStart + per * 0.9) };
    });
  };

  const stamp = (ms) => {
    const total = Math.max(0, Math.round(ms / 10));
    const mm = String(Math.floor(total / 6000)).padStart(2, '0');
    const ss = String(Math.floor((total % 6000) / 100)).padStart(2, '0');
    return `[${mm}:${ss}.${String(total % 100).padStart(2, '0')}]`;
  };

  const buildLyrics = (track, kind) => {
    const base = { kind, title: track.title, artist: track.artist, album: track.album, durationSeconds: track.durationSeconds, offsetMs: 0, provider: kind === 'empty' ? 'none' : 'local', lines: [], plainText: null, syncedText: null };
    if (kind === 'empty' || kind === 'instrumental') return base;
    const rnd = mulberry32(track.id.length * 131 + Number(track.id.replace(/\D/g, '')) * 17);
    const lines = [];
    const end = track.durationSeconds * 1000 - 4000;
    const offset = Math.floor(rnd() * LYRIC_LINES.length);
    let t = 1500;
    while (t < end && lines.length < 400) {
      const [text, translation] = LYRIC_LINES[(lines.length + offset) % LYRIC_LINES.length];
      const next = Math.min(end, t + 3200 + Math.floor(rnd() * 2800));
      lines.push({
        timeMs: t,
        text,
        translation: lines.length % 2 === 0 ? translation : null,
        romanization: null,
        kana: null,
        words: splitWords(text, t, next - 350, lines.length % 7 === 6),
      });
      t = next;
    }
    base.plainText = lines.map((line) => line.text).join('\n');
    if (kind === 'plain') return base;
    base.lines = lines;
    base.syncedText = lines.map((line) => `${stamp(line.timeMs)}${line.text}`).join('\n');
    return base;
  };

  // ---------------------------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------------------------

  const playingFixture = () => ({ count: 40, current: 7, playback: 'playing', position: 42, currentDuration: 221, lyrics: 'synced', coverless: 0, denied: [], denyImmersive: false });
  const FIXTURES = {
    playing: playingFixture,
    paused: () => ({ ...playingFixture(), playback: 'paused' }),
    empty: () => ({ ...playingFixture(), count: 0, current: -1, playback: 'stopped', position: 0, albumCount: 0 }),
    'no-lyrics': () => ({ ...playingFixture(), lyrics: 'empty' }),
    'plain-lyrics': () => ({ ...playingFixture(), lyrics: 'plain' }),
    instrumental: () => ({ ...playingFixture(), lyrics: 'instrumental' }),
    ended: () => ({ ...playingFixture(), playback: 'ended', position: 221 }),
    denied: () => ({ ...playingFixture(), denied: ['library:read', 'playback:read'] }),
    'denied-immersive': () => ({ ...playingFixture(), denyImmersive: true }),
    large: () => ({ ...playingFixture(), count: 500, current: 233, coverless: 0.6 }),
    'library-paged': () => ({ ...playingFixture(), albumCount: 200 }),
    single: () => ({ ...playingFixture(), count: 1, current: 0 }),
    'album-empty': () => ({ ...playingFixture(), albumCount: 0 }),
    'album-denied': () => ({ ...playingFixture(), denied: ['library:read'] }),
    'album-error': () => ({ ...playingFixture(), albumError: true }),
  };
  const fixture = (FIXTURES[fixtureName] || FIXTURES.playing)();
  const denied = new Set(fixture.denied);

  const items = makeItems(fixture.count, fixture.coverless);
  if (fixture.current >= 0 && items[fixture.current]) items[fixture.current].track.durationSeconds = fixture.currentDuration;

  const albumSeeds = makeItems(fixture.albumCount ?? 135, .2);
  const libraryAlbums = albumSeeds.map(({ track }, i) => ({
    id: `mock-album-${i}`, title: `专辑 ${String(i + 1).padStart(3, '0')} · ${track.album}`,
    albumArtist: track.artist, mediaType: 'local', year: track.year,
    trackCount: i === 0 ? 72 : 5, durationSeconds: i === 0 ? 14400 : 1000, coverUrl: track.coverUrl,
  }));
  const albumTracks = id => {
    const index = libraryAlbums.findIndex(a => a.id === id);
    const album = libraryAlbums[index];
    if (!album) throw new Error('album-unavailable');
    return Array.from({ length: album.trackCount }, (_, i) => ({ ...albumSeeds[index].track,
      id: `${id}-track-${i}`, title: params.get('wall') !== 'albums' && params.get('longTitle') === '1' && index === 0 && i === 0
        ? '夜航备忘 — 在格子之间等到天亮 (Live)' : `曲目 ${String(i + 1).padStart(2, '0')}`, album: album.title,
      albumArtist: album.albumArtist, trackNo: i + 1, unavailable: i === 3,
    }));
  };
  const pageOf = (list, query = {}) => {
    const page = Math.max(1, query.page || 1), pageSize = query.pageSize || 20;
    const start = (page - 1) * pageSize;
    return { page, pageSize, total: list.length, hasMore: start + pageSize < list.length, items: list.slice(start, start + pageSize) };
  };
  const libraryTracks = libraryAlbums.flatMap((album) => albumTracks(album.id));
  const libraryPlay = track => {
    items.splice(0, items.length, { queueId: `play-${track.id}`, track });
    goTo(0); return { track };
  };

  const SETTING_DEFAULTS = {
    immersive: true, 'auto-focus': true, 'lighting-mode': 'spotlight', vignette: true, 'lights-out': false, 'poster-tint': true, 'poster-tint-custom': false,
    'poster-tint-color': '#000000', 'poster-tint-intensity': 0.5, 'cell-size': 'M', 'show-lyrics': true, 'show-translation': true, 'ui-font': '',
  };
  const APPEARANCE = {
    dark: { accent: '#5cc8dc', accentText: '#08111f', panel: '#142234', text: '#c8dce8', heading: '#f4fbff', muted: '#8eabc0', appBg: '#08111f', border: '#2a3d52', player: '#142234' },
    light: { accent: '#0e7c99', accentText: '#ffffff', panel: '#ffffff', text: '#1d2a36', heading: '#0b141d', muted: '#5f7385', appBg: '#f2f5f8', border: '#d5dde5', player: '#ffffff' },
  };
  const PANEL_SIZES = ['compact', 'comfortable', 'wide', 'full'].concat(fixture.denyImmersive ? [] : ['immersive']);

  const state = {
    index: fixture.current,
    playback: fixture.playback,
    anchorPosition: fixture.position,
    anchorAt: performance.now(),
    colorScheme: params.get('scheme') === 'light' ? 'light' : 'dark',
    reducedMotion: params.get('reducedMotion') === '1',
    presentation: { title: PANEL_TITLE, badge: null, dirty: false, attention: 'none', size: 'comfortable' },
    settings: { ...SETTING_DEFAULTS },
    storage: new Map(),
    lyricsCache: new Map(),
    shuffle: false,
    repeat: 'all',
  };

  // ---------------------------------------------------------------------------------------------
  // Playback engine
  // ---------------------------------------------------------------------------------------------

  const currentItem = () => (state.index >= 0 ? items[state.index] || null : null);
  const duration = () => (currentItem() ? currentItem().track.durationSeconds : 0);
  const position = () => {
    if (state.playback !== 'playing') return state.anchorPosition;
    return Math.min(duration(), state.anchorPosition + (performance.now() - state.anchorAt) / 1000);
  };
  const setPosition = (seconds) => {
    state.anchorPosition = Math.max(0, Math.min(duration(), seconds));
    state.anchorAt = performance.now();
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const handler of listeners.get(name) || []) {
      try {
        handler(clone(payload));
      } catch (error) {
        console.error(`[lattice-mock] ${name} handler threw`, error);
      }
    }
  };

  const snapshotQueue = () => ({
    currentQueueId: currentItem() ? currentItem().queueId : null,
    currentTrack: currentItem() ? currentItem().track : null,
    canGoPrevious: items.length > 0,
    canGoNext: items.length > 0,
    shuffleEnabled: state.shuffle,
    repeatMode: state.repeat,
    items: items.slice(0, QUEUE_CAP),
  });
  const snapshotStatus = () => ({
    state: state.playback,
    currentTrackId: currentItem() ? currentItem().track.id : null,
    positionSeconds: position(),
    durationSeconds: duration(),
    volume: 0.8,
    shuffleEnabled: state.shuffle,
    repeatMode: state.repeat,
  });
  const emitStatus = () => {
    if (!denied.has('playback:read')) emit('playback:status', snapshotStatus());
  };
  const emitQueue = () => {
    if (!denied.has('queue:read')) emit('queue:changed', snapshotQueue());
  };

  const goTo = (index) => {
    if (items.length === 0) throw new Error('queue-unavailable');
    state.index = ((index % items.length) + items.length) % items.length;
    state.playback = 'playing';
    setPosition(0);
    emitQueue();
    emitStatus();
  };
  const play = () => {
    if (!currentItem()) throw new Error('playback-unavailable');
    if (state.playback === 'ended') setPosition(0);
    else setPosition(state.anchorPosition);
    state.playback = 'playing';
    emitStatus();
  };
  const pause = () => {
    if (!currentItem()) throw new Error('playback-unavailable');
    state.anchorPosition = position();
    state.playback = 'paused';
    emitStatus();
  };
  const seek = (seconds) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('invalid-payload');
    if (!currentItem()) throw new Error('playback-unavailable');
    if (state.playback === 'ended') state.playback = 'paused';
    setPosition(seconds);
    emitStatus();
  };

  setInterval(() => {
    if (state.playback !== 'playing') return;
    if (position() >= duration()) {
      state.playback = 'ended';
      setPosition(duration());
      emitStatus();
      setTimeout(() => {
        if (state.playback === 'ended') goTo(state.index + 1);
      }, 1000);
      return;
    }
    emitStatus();
  }, 1000);

  // ---------------------------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------------------------

  const context = () => ({
    surface: 'panel',
    panel: { id: 'wall', placement: 'player' },
    visible: document.visibilityState !== 'hidden',
    locale: 'zh-CN',
    direction: 'ltr',
    colorScheme: state.colorScheme,
    reducedMotion: state.reducedMotion,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    appearance: { ...APPEARANCE[state.colorScheme] },
    presentation: { ...state.presentation },
  });
  const emitContext = () => emit('ui:context-changed', context());
  const tellParent = (message) => {
    if (window.parent && window.parent !== window) window.parent.postMessage({ channel: 'lattice-mock', ...message }, '*');
  };

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(emitContext);
  });
  document.addEventListener('visibilitychange', emitContext);

  // ---------------------------------------------------------------------------------------------
  // Request plumbing (latency, rate warning, capability guard)
  // ---------------------------------------------------------------------------------------------

  const recentRequests = [];
  const request = (action, fn) => new Promise((resolve, reject) => {
    const now = performance.now();
    recentRequests.push(now);
    while (recentRequests.length > 0 && now - recentRequests[0] > 1000) recentRequests.shift();
    if (recentRequests.length > RATE_LIMIT_PER_SECOND) console.warn(`[lattice-mock] ${recentRequests.length} requests in the last second (host limit ${RATE_LIMIT_PER_SECOND}/s) — ${action}`);
    setTimeout(() => {
      try {
        resolve(clone(fn() ?? null));
      } catch (error) {
        reject(error);
      }
    }, LATENCY_MS);
  });
  const guarded = (permission, fn) => () => {
    if (denied.has(permission)) throw new Error('capability-denied');
    return fn();
  };
  const on = (name, handler) => {
    if (typeof name !== 'string' || typeof handler !== 'function') return () => undefined;
    const set = listeners.get(name) || new Set();
    set.add(handler);
    listeners.set(name, set);
    return () => set.delete(handler);
  };

  const ACTION_PERMISSIONS = {
    'host:getCapabilities': null, 'host:getFeatureAvailability': null, 'ui:getContext': null, 'ui:setPanelPresentation': null, 'ui:openPanel': null, 'ui:closePanel': null, 'ui:notify': null,
    'playback:getStatus': 'playback:read', 'playback:play': 'playback:control', 'playback:pause': 'playback:control', 'playback:seek': 'playback:control',
    'playback:previous': 'playback:control', 'playback:next': 'playback:control',
    'playback:toggleShuffle': 'playback:control', 'playback:setShuffle': 'playback:control',
    'playback:setRepeat': 'playback:control', 'playback:cycleRepeat': 'playback:control',
    'queue:get': 'queue:read', 'queue:playItem': 'queue:control',
    'lyrics:get': 'lyrics:read', 'settings:get': 'fs:plugin', 'settings:set': 'fs:plugin', 'storage:get': 'fs:plugin', 'storage:set': 'fs:plugin', 'storage:remove': 'fs:plugin',
    'library:getAlbums': 'library:read', 'library:getAlbumTracks': 'library:read', 'library:getTracks': 'library:read',
    'queue:playAlbum': 'queue:control', 'queue:playTrack': 'queue:control',
  };
  const availability = (featureId) => {
    if (!(featureId in ACTION_PERMISSIONS)) return { supported: false, granted: false, available: false, reason: 'feature-disabled' };
    const permission = ACTION_PERMISSIONS[featureId];
    if (permission !== null && denied.has(permission)) return { supported: true, granted: false, available: false, reason: 'capability-not-approved' };
    return { supported: true, granted: true, available: true, reason: null };
  };

  // ---------------------------------------------------------------------------------------------
  // `echo`
  // ---------------------------------------------------------------------------------------------

  const echo = Object.freeze({
    host: Object.freeze({
      getCapabilities: () => request('host:getCapabilities', () => ({
        apiVersion: 2,
        features: Object.fromEntries(Object.keys(ACTION_PERMISSIONS).map((id) => [id, availability(id)])),
      })),
      getFeatureAvailability: (featureId) => request('host:getFeatureAvailability', () => availability(String(featureId))),
    }),
    events: Object.freeze({ on }),
    ui: Object.freeze({
      notify: (message) => request('ui:notify', () => {
        console.info('[lattice-mock] notify:', message);
        tellParent({ type: 'notify', message: String(message).slice(0, 200) });
        return null;
      }),
      getContext: () => request('ui:getContext', context),
      setPanelPresentation: (presentation) => request('ui:setPanelPresentation', () => {
        if (typeof presentation !== 'object' || presentation === null) throw new Error('invalid-payload');
        const next = { ...state.presentation };
        for (const key of Object.keys(presentation)) {
          const value = presentation[key];
          if (key === 'title' && typeof value === 'string') next.title = value.slice(0, 80);
          else if (key === 'badge' && (value === null || typeof value === 'string')) next.badge = value;
          else if (key === 'dirty' && typeof value === 'boolean') next.dirty = value;
          else if (key === 'attention' && ['none', 'info', 'warning'].includes(value)) next.attention = value;
          else if (key === 'size' && PANEL_SIZES.includes(value)) next.size = value;
          else throw new Error('invalid-payload');
        }
        state.presentation = next;
        tellParent({ type: 'presentation', presentation: next });
        setTimeout(emitContext, 0);
        return next;
      }),
      openPanel: (panelId) => request('ui:openPanel', () => {
        const id = typeof panelId === 'string' ? panelId.trim() : '';
        tellParent({ type: 'open-panel', panelId: id || null });
        return id ? { id, title: id } : null;
      }),
      closePanel: () => request('ui:closePanel', () => {
        tellParent({ type: 'closed' });
        return null;
      }),
      onContextChanged: (handler) => on('ui:context-changed', handler),
    }),
    settings: Object.freeze({
      get: (settingId) => request('settings:get', guarded('fs:plugin', () => {
        if (settingId === undefined) return state.settings;
        if (!(settingId in SETTING_DEFAULTS)) throw new Error('setting-undeclared');
        return state.settings[settingId];
      })),
      set: (settingId, value) => request('settings:set', guarded('fs:plugin', () => {
        if (!(settingId in SETTING_DEFAULTS)) throw new Error('setting-undeclared');
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('invalid-payload');
        state.settings[settingId] = value;
        setTimeout(() => emit('settings:changed', state.settings), 0);
        return state.settings;
      })),
      onChanged: (handler) => on('settings:changed', handler),
    }),
    storage: Object.freeze({
      get: (key) => request('storage:get', guarded('fs:plugin', () => (state.storage.has(String(key)) ? state.storage.get(String(key)) : null))),
      set: (key, value) => request('storage:set', guarded('fs:plugin', () => {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new Error('invalid-payload');
        if (serialized.length > STORAGE_VALUE_LIMIT) throw new Error('storage-quota-exceeded');
        state.storage.set(String(key), JSON.parse(serialized));
        return null;
      })),
      remove: (key) => request('storage:remove', guarded('fs:plugin', () => {
        state.storage.delete(String(key));
        return null;
      })),
    }),
    library: Object.freeze({
      getAlbums: (query = {}) => request('library:getAlbums', guarded('library:read', () => {
        if (fixture.albumError) throw new Error('library-unavailable');
        const search = (query.search || '').toLocaleLowerCase();
        return pageOf(libraryAlbums.filter(a => `${a.title} ${a.albumArtist}`.toLocaleLowerCase().includes(search)), query);
      })),
      getAlbumTracks: (id, query) => request('library:getAlbumTracks', guarded('library:read', () => pageOf(albumTracks(id), query))),
      getTracks: (query = {}) => request('library:getTracks', guarded('library:read', () => {
        if (fixture.albumError) throw new Error('library-unavailable');
        const search = (query.search || '').toLocaleLowerCase();
        return pageOf(libraryTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(search)), query);
      })),
    }),
    queue: Object.freeze({
      playAlbum: id => request('queue:playAlbum', guarded('queue:control', () => {
        const tracks = albumTracks(id).filter(t => !t.unavailable);
        items.splice(0, items.length, ...tracks.map(track => ({ queueId: `play-${track.id}`, track })));
        goTo(0); return { track: tracks[0], count: tracks.length };
      })),
      playTrack: (id, queueIds) => request('queue:playTrack', guarded('queue:control', () => {
        const track = libraryTracks.find((item) => item.id === id);
        if (!track || track.unavailable) throw new Error('track-unavailable');
        if (Array.isArray(queueIds) && queueIds.length > 0) {
          const selected = queueIds.map((trackId) => libraryTracks.find((item) => item.id === trackId)).filter(Boolean);
          if (selected.length > 0) {
            items.splice(0, items.length, ...selected.map((item) => ({ queueId: `play-${item.id}`, track: item })));
            const index = selected.findIndex((item) => item.id === id);
            goTo(index >= 0 ? index : 0);
            return { track, count: selected.length };
          }
        }
        return libraryPlay(track);
      })),
      get: () => request('queue:get', guarded('queue:read', snapshotQueue)),
      playItem: (queueId) => request('queue:playItem', guarded('queue:control', () => {
        const index = items.findIndex((item) => item.queueId === queueId);
        if (index < 0) throw new Error('track-unavailable');
        goTo(index);
        return null;
      })),
    }),
    playback: Object.freeze({
      getStatus: () => request('playback:getStatus', guarded('playback:read', snapshotStatus)),
      play: () => request('playback:play', guarded('playback:control', () => (play(), null))),
      pause: () => request('playback:pause', guarded('playback:control', () => (pause(), null))),
      seek: (positionSeconds) => request('playback:seek', guarded('playback:control', () => (seek(positionSeconds), null))),
      next: () => request('playback:next', guarded('playback:control', () => (goTo(state.index + 1), null))),
      previous: () => request('playback:previous', guarded('playback:control', () => (goTo(state.index - 1), null))),
      toggleShuffle: () => request('playback:toggleShuffle', guarded('playback:control', () => {
        state.shuffle = !state.shuffle;
        emitQueue();
        emitStatus();
        return null;
      })),
      setShuffle: (enabled) => request('playback:setShuffle', guarded('playback:control', () => {
        state.shuffle = enabled === true;
        emitQueue();
        emitStatus();
        return null;
      })),
      setRepeat: (mode) => request('playback:setRepeat', guarded('playback:control', () => {
        if (mode !== 'off' && mode !== 'one' && mode !== 'all') throw new Error('invalid-payload');
        state.repeat = mode;
        emitQueue();
        emitStatus();
        return null;
      })),
      cycleRepeat: () => request('playback:cycleRepeat', guarded('playback:control', () => {
        state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
        emitQueue();
        emitStatus();
        return null;
      })),
    }),
    lyrics: Object.freeze({
      get: (trackId) => request('lyrics:get', guarded('lyrics:read', () => {
        const id = trackId === undefined ? (currentItem() ? currentItem().track.id : null) : String(trackId);
        const item = items.find((entry) => entry.track.id === id);
        if (!item) return null;
        if (!state.lyricsCache.has(id)) {
          if (state.lyricsCache.size >= 8) state.lyricsCache.delete(state.lyricsCache.keys().next().value);
          state.lyricsCache.set(id, buildLyrics(item.track, fixture.lyrics));
        }
        return state.lyricsCache.get(id);
      })),
    }),
  });

  Object.defineProperty(globalThis, 'echo', { value: echo, configurable: false, writable: false });

  // ---------------------------------------------------------------------------------------------
  // Harness controls (reached by the index page through `iframe.contentWindow.__latticeMock`)
  // ---------------------------------------------------------------------------------------------

  const safely = (fn) => {
    try {
      fn();
    } catch (error) {
      console.warn('[lattice-mock]', error instanceof Error ? error.message : error);
    }
  };
  window.__latticeMock = Object.freeze({
    fixture: fixtureName,
    fixtures: Object.keys(FIXTURES),
    next: () => safely(() => goTo(state.index + 1)),
    previous: () => safely(() => goTo(state.index - 1)),
    play: () => safely(play),
    pause: () => safely(pause),
    togglePlay: () => safely(() => (state.playback === 'playing' ? pause() : play())),
    seekBy: (seconds) => safely(() => seek(position() + Number(seconds))),
    seekTo: (seconds) => safely(() => seek(Number(seconds))),
    playIndex: (index) => safely(() => goTo(Number(index))),
    setColorScheme: (scheme) => {
      state.colorScheme = scheme === 'light' ? 'light' : 'dark';
      emitContext();
    },
    setReducedMotion: (enabled) => {
      state.reducedMotion = Boolean(enabled);
      emitContext();
    },
    snapshot: () => ({
      fixture: fixtureName,
      state: state.playback,
      positionSeconds: position(),
      durationSeconds: duration(),
      index: state.index,
      count: items.length,
      title: currentItem() ? currentItem().track.title : null,
      presentationSize: state.presentation.size,
      colorScheme: state.colorScheme,
      reducedMotion: state.reducedMotion,
    }),
  });

  console.info(`[lattice-mock] fixture "${fixtureName}" · ${items.length} items · ${state.playback}`);
})();
