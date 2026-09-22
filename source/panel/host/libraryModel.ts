import type { RequiredCapability, Tile } from '../types.ts';
import { FALLBACK_ARTIST, FALLBACK_TITLE } from './queueModel.ts';

/** Tracks shown on one wall. Above this, the browser pages; the host still serves at most 100 per call. */
export const LIBRARY_WALL_PAGE_SIZE = 800;
/** Host `library:getTracks` cap (`WorkshopPluginMediaBridge.maximumPageSize`). */
export const LIBRARY_HOST_PAGE_SIZE = 100;
/** Host `queue.playTrack` accepts at most this many context ids. */
export const LIBRARY_PLAY_CONTEXT_LIMIT = 200;

const HOST_PAGES_PER_WALL = LIBRARY_WALL_PAGE_SIZE / LIBRARY_HOST_PAGE_SIZE;

export const LIBRARY_WALL_PROBES: ReadonlyArray<readonly [RequiredCapability, string]> = [
  ['library:read', 'library:getTracks'],
  ['playback:read', 'playback:getStatus'],
  ['playback:control', 'playback:play'],
  ['queue:control', 'queue:playTrack'],
  ['lyrics:read', 'lyrics:get'],
  ['fs:plugin', 'settings:get'],
];

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value : fallback;

export function libraryTrackTiles(tracks: readonly EchoWorkshopTrack[], page: number): Tile[] {
  const origin = Math.max(0, page - 1) * LIBRARY_WALL_PAGE_SIZE;
  return tracks.map((track, offset) => ({
    index: origin + offset,
    queueId: track.id,
    trackId: track.id,
    title: text(track.title, FALLBACK_TITLE),
    artist: text(track.artist, FALLBACK_ARTIST),
    album: text(track.album, ''),
    coverUrl: typeof track.coverUrl === 'string' && track.coverUrl !== '' ? track.coverUrl : null,
    durationSeconds: typeof track.durationSeconds === 'number' && Number.isFinite(track.durationSeconds) && track.durationSeconds > 0
      ? track.durationSeconds
      : 0,
  }));
}

export function currentLibraryIndex(tiles: readonly Tile[], trackId: string | null | undefined): number | null {
  if (!trackId) return null;
  const found = tiles.findIndex((tile) => tile.trackId === trackId);
  return found >= 0 ? found : null;
}

export function libraryPageNotice(page: Pick<EchoWorkshopPage<unknown>, 'page' | 'pageSize' | 'total'>): string {
  const pages = Math.max(1, Math.ceil(page.total / Math.max(1, page.pageSize)));
  if (pages <= 1) return `共 ${page.total} 首`;
  return `第 ${page.page} / ${pages} 页 · 共 ${page.total} 首`;
}

/** Window of track ids around the chosen card; never exceeds the host play-context cap. */
export function playContextIds(tiles: readonly Tile[], centerIndex: number, limit = LIBRARY_PLAY_CONTEXT_LIMIT): string[] {
  if (tiles.length <= limit) return tiles.map((tile) => tile.trackId);
  const safeCenter = Math.min(Math.max(0, centerIndex), tiles.length - 1);
  const half = Math.floor(limit / 2);
  let start = Math.max(0, safeCenter - half);
  let end = Math.min(tiles.length, start + limit);
  start = Math.max(0, end - limit);
  const ids: string[] = [];
  for (let index = start; index < end; index++) {
    const tile = tiles[index];
    if (tile) ids.push(tile.trackId);
  }
  return ids;
}

/**
 * Assembles one wall page from several host pages. Stops early when the library (or search)
 * has fewer than 800 remaining tracks. Only the current wall page is retained.
 */
export function createLibraryTrackLoader(
  read: (query: EchoWorkshopPageQuery) => Promise<EchoWorkshopPage<EchoWorkshopTrack>>,
) {
  let generation = 0;
  return {
    async load(wallPage: number, search = ''): Promise<EchoWorkshopPage<EchoWorkshopTrack> | null> {
      const request = ++generation;
      const page = Number.isInteger(wallPage) && wallPage > 0 ? wallPage : 1;
      const hostStart = (page - 1) * HOST_PAGES_PER_WALL + 1;
      const items: EchoWorkshopTrack[] = [];
      let total = 0;

      for (let step = 0; step < HOST_PAGES_PER_WALL; step++) {
        const result = await read({
          page: hostStart + step,
          pageSize: LIBRARY_HOST_PAGE_SIZE,
          search,
        });
        if (request !== generation) return null;
        total = result.total;
        items.push(...result.items.slice(0, LIBRARY_HOST_PAGE_SIZE));
        const offset = (hostStart - 1) * LIBRARY_HOST_PAGE_SIZE + items.length;
        if (!result.hasMore || items.length >= LIBRARY_WALL_PAGE_SIZE || offset >= total) break;
      }

      if (request !== generation) return null;
      const kept = items.slice(0, LIBRARY_WALL_PAGE_SIZE);
      const seen = (page - 1) * LIBRARY_WALL_PAGE_SIZE + kept.length;
      return {
        page,
        pageSize: LIBRARY_WALL_PAGE_SIZE,
        total,
        hasMore: seen < total,
        items: kept,
      };
    },
    cancel() { generation++; },
  };
}
