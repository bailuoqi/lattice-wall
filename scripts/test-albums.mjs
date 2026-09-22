import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumTiles, currentAlbumIndex, createPageLoader, ALBUM_PAGE_SIZE, ALBUM_PROBES } from '../source/panel/albums/albumModel.ts';
import { deriveMissingCapabilities } from '../source/panel/host/bridge.ts';

const album = (overrides = {}) => ({ id: 'a', title: 'Album', albumArtist: 'Artist', mediaType: 'local', year: 2026, trackCount: 12, durationSeconds: 2400, coverUrl: null, ...overrides });
const track = (overrides = {}) => ({ id: 'song', album: 'Album', artist: 'Guest', albumArtist: 'Artist', mediaType: 'local', ...overrides });

test('album identity and numbering use the host one-based pages, independently of queue IDs', () => {
  const first = albumTiles([album()], 1)[0];
  const next = albumTiles([album()], 2)[0];
  assert.equal(first.index, 0);
  assert.equal(next.index, 60);
  assert.equal(next.queueId, first.queueId);
  assert.equal(next.albumId, 'a');
  assert.equal(next.coverUrl, null);
});

test('current album requires a unique title, album artist and media type match', () => {
  assert.equal(currentAlbumIndex([album()], track()), 0);
  assert.equal(currentAlbumIndex([album({ title: ' ALBUM ' })], track()), 0);
  assert.equal(currentAlbumIndex([album()], track({ albumArtist: 'Other' })), null);
  assert.equal(currentAlbumIndex([album()], track({ mediaType: 'remote' })), null);
  assert.equal(currentAlbumIndex([album(), album({ id: 'b' })], track()), null);
  assert.equal(currentAlbumIndex([album()], null), null);
  assert.equal(currentAlbumIndex([album()], track({ albumArtist: '', artist: 'Artist' })), 0);
});

test('a delayed page never replaces a newer search; cancel also discards in-flight pages', async () => {
  const requests = [];
  const loader = createPageLoader(query => new Promise((resolve, reject) => requests.push({ query, resolve, reject })), ALBUM_PAGE_SIZE);
  const old = loader.load(1, 'old');
  const fresh = loader.load(2, 'new');
  assert.deepEqual(requests[1].query, { page: 2, pageSize: 60, search: 'new' });
  requests[1].resolve({ page: 2, pageSize: 60, total: 90, hasMore: false, items: [album()] });
  assert.equal((await fresh).page, 2);
  requests[0].reject(new Error('late failure'));
  assert.equal(await old, null);
  const cancelled = loader.load(1);
  loader.cancel();
  requests[2].resolve({ items: [album()] });
  assert.equal(await cancelled, null);
});

test('the page loader retains only the requested page size and exposes current errors', async () => {
  const loader = createPageLoader(async () => ({ items: Array.from({ length: 1000 }, () => album()) }), ALBUM_PAGE_SIZE);
  assert.equal((await loader.load(1)).items.length, 60);
  const failed = createPageLoader(async () => { throw new Error('offline'); }, 50);
  await assert.rejects(failed.load(1), /offline/);
});

test('album capability probing requires library and collection playback but not lyrics', () => {
  const features = Object.fromEntries(ALBUM_PROBES.map(([, action]) => [action, { granted: true, available: true }]));
  assert.deepEqual(deriveMissingCapabilities({ features }, ALBUM_PROBES), []);
  features['library:getAlbums'].granted = false;
  assert.deepEqual(deriveMissingCapabilities({ features }, ALBUM_PROBES), ['library:read']);
  features['queue:playAlbum'].available = false;
  assert.deepEqual(deriveMissingCapabilities({ features }, ALBUM_PROBES), ['library:read', 'queue:control']);
});
