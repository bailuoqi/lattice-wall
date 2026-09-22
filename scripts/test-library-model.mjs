import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveMissingCapabilities } from '../source/panel/host/bridge.ts';
import {
  createLibraryTrackLoader,
  currentLibraryIndex,
  LIBRARY_HOST_PAGE_SIZE,
  LIBRARY_PLAY_CONTEXT_LIMIT,
  LIBRARY_WALL_PAGE_SIZE,
  LIBRARY_WALL_PROBES,
  libraryPageNotice,
  libraryTrackTiles,
  playContextIds,
} from '../source/panel/host/libraryModel.ts';

const track = (index, overrides = {}) => ({
  id: `track-${index}`,
  mediaType: 'local',
  title: `Title ${index}`,
  artist: `Artist ${index}`,
  album: `Album ${index}`,
  albumArtist: `Artist ${index}`,
  trackNo: index,
  discNo: 1,
  year: 2024,
  genre: null,
  durationSeconds: 180,
  codec: 'flac',
  sampleRate: 44_100,
  bitDepth: 16,
  bitrate: null,
  coverUrl: `echo-cover://thumb/${index}`,
  unavailable: false,
  ...overrides,
});

const catalog = (count) => Array.from({ length: count }, (_, index) => track(index + 1));

const hostReader = (tracks) => {
  const queries = [];
  const read = async (query) => {
    queries.push({ page: query.page, pageSize: query.pageSize, search: query.search ?? '' });
    const pageSize = query.pageSize ?? LIBRARY_HOST_PAGE_SIZE;
    const page = query.page ?? 1;
    const start = (page - 1) * pageSize;
    const items = tracks.slice(start, start + pageSize);
    return {
      page,
      pageSize,
      total: tracks.length,
      hasMore: start + items.length < tracks.length,
      items,
    };
  };
  return { queries, read };
};

test('library tiles use track ids and wall-page numbering', () => {
  const first = libraryTrackTiles([track(1, { title: '', artist: '', album: '', coverUrl: '' })], 1)[0];
  const later = libraryTrackTiles([track(2)], 2)[0];
  assert.equal(first.trackId, 'track-1');
  assert.equal(first.queueId, 'track-1');
  assert.equal(first.title, '未知标题');
  assert.equal(first.artist, '未知艺术家');
  assert.equal(first.coverUrl, null);
  assert.equal(first.index, 0);
  assert.equal(later.index, LIBRARY_WALL_PAGE_SIZE);
});

test('current library index matches the playing track on this page only', () => {
  const tiles = libraryTrackTiles([track(1), track(2), track(3)], 1);
  assert.equal(currentLibraryIndex(tiles, 'track-2'), 1);
  assert.equal(currentLibraryIndex(tiles, 'track-9'), null);
  assert.equal(currentLibraryIndex(tiles, null), null);
});

test('page notice hides paging when the library fits on one wall', () => {
  assert.equal(libraryPageNotice({ page: 1, pageSize: 800, total: 523 }), '共 523 首');
  assert.equal(libraryPageNotice({ page: 2, pageSize: 800, total: 2000 }), '第 2 / 3 页 · 共 2000 首');
});

test('play context stays inside the host 200-id cap and keeps the chosen track', () => {
  const tiles = libraryTrackTiles(catalog(800), 1);
  const around = playContextIds(tiles, 10);
  assert.equal(around.length, LIBRARY_PLAY_CONTEXT_LIMIT);
  assert.ok(around.includes('track-11'));
  assert.equal(playContextIds(tiles.slice(0, 40), 3).length, 40);
});

test('the wall loader stops after the last host page when the library is under 800', async () => {
  const { queries, read } = hostReader(catalog(250));
  const loader = createLibraryTrackLoader(read);
  const result = await loader.load(1, '');
  assert.equal(result.items.length, 250);
  assert.equal(result.pageSize, LIBRARY_WALL_PAGE_SIZE);
  assert.equal(result.hasMore, false);
  assert.deepEqual(queries.map((query) => query.page), [1, 2, 3]);
  assert.ok(queries.every((query) => query.pageSize === LIBRARY_HOST_PAGE_SIZE));
});

test('801 tracks fill the first wall and leave a one-track second page', async () => {
  const { queries, read } = hostReader(catalog(801));
  const loader = createLibraryTrackLoader(read);
  const first = await loader.load(1, '');
  assert.equal(first.items.length, 800);
  assert.equal(first.hasMore, true);
  assert.deepEqual(queries.map((query) => query.page), [1, 2, 3, 4, 5, 6, 7, 8]);
  queries.length = 0;
  const second = await loader.load(2, '');
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].id, 'track-801');
  assert.equal(second.hasMore, false);
  assert.deepEqual(queries.map((query) => query.page), [9]);
});

test('the wall loader pages by 800 and maps wall page 2 onto host pages 9–16', async () => {
  const { queries, read } = hostReader(catalog(1600));
  const loader = createLibraryTrackLoader(read);
  const result = await loader.load(2, 'live');
  assert.equal(result.page, 2);
  assert.equal(result.items.length, 800);
  assert.equal(result.items[0].id, 'track-801');
  assert.equal(result.hasMore, false);
  assert.deepEqual(queries.map((query) => query.page), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.ok(queries.every((query) => query.search === 'live'));
});

test('a delayed wall page never replaces a newer search', async () => {
  const requests = [];
  const loader = createLibraryTrackLoader((query) => new Promise((resolve) => {
    requests.push({ query, resolve });
  }));
  const stale = loader.load(1, 'old');
  const fresh = loader.load(1, 'new');
  requests[1].resolve({
    page: 1, pageSize: 100, total: 40, hasMore: false, items: catalog(40),
  });
  assert.equal((await fresh).items.length, 40);
  requests[0].resolve({
    page: 1, pageSize: 100, total: 40, hasMore: false, items: catalog(40),
  });
  assert.equal(await stale, null);
});

test('library wall probes require library reads and track playback, not the queue snapshot', () => {
  const features = Object.fromEntries(LIBRARY_WALL_PROBES.map(([, action]) => [action, { granted: true, available: true }]));
  assert.deepEqual(deriveMissingCapabilities({ features }, LIBRARY_WALL_PROBES), []);
  features['library:getTracks'].granted = false;
  assert.deepEqual(deriveMissingCapabilities({ features }, LIBRARY_WALL_PROBES), ['library:read']);
  assert.ok(!LIBRARY_WALL_PROBES.some(([, action]) => action === 'queue:get'));
});
