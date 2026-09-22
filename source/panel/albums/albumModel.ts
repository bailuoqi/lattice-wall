import type { RequiredCapability, Tile } from '../types.ts';

export const ALBUM_PAGE_SIZE = 60;
export const TRACK_PAGE_SIZE = 50;
export const ALBUM_PROBES: ReadonlyArray<readonly [RequiredCapability, string]> = [
  ['library:read', 'library:getAlbums'],
  ['library:read', 'library:getAlbumTracks'],
  ['queue:read', 'queue:get'],
  ['queue:control', 'queue:playAlbum'],
  ['queue:control', 'queue:playTrack'],
  ['playback:read', 'playback:getStatus'],
  ['playback:control', 'playback:play'],
  ['fs:plugin', 'settings:get'],
];

export function albumTiles(albums: EchoWorkshopAlbum[], page: number): Tile[] {
  return albums.map((album, index) => ({
    index: (page - 1) * ALBUM_PAGE_SIZE + index,
    queueId: `album:${album.id}`,
    albumId: album.id,
    trackId: album.id,
    title: album.title || '未知专辑',
    artist: album.albumArtist || '未知艺术家',
    album: `${album.trackCount} 首${album.year ? ` · ${album.year}` : ''}`,
    coverUrl: album.coverUrl,
    durationSeconds: album.durationSeconds,
  }));
}

const normalized = (value: string): string => value.trim().normalize('NFKC').toLocaleLowerCase();

/** The SDK track DTO has no albumId. Highlight only an unambiguous metadata match on this page. */
export function currentAlbumIndex(albums: EchoWorkshopAlbum[], track: EchoWorkshopTrack | null): number | null {
  if (!track?.album) return null;
  const title = normalized(track.album);
  const artist = normalized(track.albumArtist || track.artist);
  const matches = albums.flatMap((album, i) =>
    normalized(album.title) === title && normalized(album.albumArtist) === artist && album.mediaType === track.mediaType ? [i] : []);
  return matches.length === 1 ? matches[0]! : null;
}

/** Ignore stale responses without accumulating a cache of old album/track pages. */
export function createPageLoader<T>(read: (query: EchoWorkshopPageQuery) => Promise<EchoWorkshopPage<T>>, pageSize: number) {
  let generation = 0;
  return {
    async load(page: number, search = ''): Promise<EchoWorkshopPage<T> | null> {
      const request = ++generation;
      try {
        const result = await read({ page, pageSize, search });
        if (request !== generation) return null;
        return { ...result, items: result.items.slice(0, pageSize) };
      } catch (error) {
        if (request !== generation) return null;
        throw error;
      }
    },
    cancel() { generation++; },
  };
}
