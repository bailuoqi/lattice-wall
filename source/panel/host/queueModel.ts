import type { QueueDiff, QueueModel, Tile } from '../types.ts';

/** The host caps queue snapshots at this many items (WorkshopPluginMediaBridge). */
export const QUEUE_TRUNCATION_LIMIT = 500;

export const FALLBACK_TITLE = '未知标题';
export const FALLBACK_ARTIST = '未知艺术家';

export const emptyQueueModel = (): QueueModel => ({
  tiles: [],
  currentIndex: null,
  currentQueueId: null,
  truncated: false,
});

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function toTile(item: unknown, index: number): Tile | null {
  if (!isRecord(item) || typeof item.queueId !== 'string' || item.queueId === '') return null;
  const track: Record<string, unknown> = isRecord(item.track) ? item.track : {};
  const duration = track.durationSeconds;
  return {
    index,
    queueId: item.queueId,
    trackId: typeof track.id === 'string' && track.id !== '' ? track.id : item.queueId,
    title: text(track.title, FALLBACK_TITLE),
    artist: text(track.artist, FALLBACK_ARTIST),
    album: text(track.album, ''),
    coverUrl: typeof track.coverUrl === 'string' && track.coverUrl !== '' ? track.coverUrl : null,
    durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
}

export function buildQueueModel(snapshot: EchoWorkshopQueueSnapshot | null): QueueModel {
  if (!snapshot || !Array.isArray(snapshot.items)) return emptyQueueModel();
  const tiles: Tile[] = [];
  for (const item of snapshot.items) {
    const tile = toTile(item, tiles.length);
    if (tile) tiles.push(tile);
  }
  const currentQueueId = typeof snapshot.currentQueueId === 'string' ? snapshot.currentQueueId : null;
  let currentIndex: number | null = null;
  if (currentQueueId !== null) {
    const found = tiles.findIndex((tile) => tile.queueId === currentQueueId);
    currentIndex = found >= 0 ? found : null;
  }
  return {
    tiles,
    currentIndex,
    currentQueueId,
    truncated: snapshot.items.length >= QUEUE_TRUNCATION_LIMIT,
  };
}

export function diffQueueModel(previous: QueueModel, next: QueueModel): QueueDiff {
  let tilesChanged = previous.tiles.length !== next.tiles.length;
  for (let i = 0; !tilesChanged && i < next.tiles.length; i += 1) {
    if (previous.tiles[i]?.queueId !== next.tiles[i]?.queueId) tilesChanged = true;
  }
  return { tilesChanged, currentChanged: previous.currentIndex !== next.currentIndex };
}
