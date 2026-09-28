import type { ClockSnapshot, LyricsViewOptions } from '../types.ts';
import { buildLyricsTimeline } from '../lyrics/lyricsModel.ts';
import { createLyricsView } from '../lyrics/lyricsView.ts';

export type AlbumLyricsHost = {
  getLyrics(trackId: string): Promise<EchoWorkshopSandboxLyrics | null>;
  readClock(): ClockSnapshot;
};

/** Reuse the library wall's lyric renderer, retaining only the active track and one pending read. */
export function createAlbumLyrics(host: AlbumLyricsHost, onLayoutChange: () => void = () => undefined) {
  const element = document.createElement('div');
  element.className = 'album-lyrics';
  element.id = `album-lyrics-${crypto.randomUUID()}`;
  const message = document.createElement('p');
  message.className = 'album-details__message';
  message.textContent = '正在同步歌曲…';
  message.setAttribute('role', 'status');
  const view = createLyricsView();
  view.element.dataset.scrollable = 'true';
  element.append(message, view.element);
  let trackId: string | null = null;
  let loadedId: string | null = null;
  let generation = 0;
  let active = false, pending = false, failed = false, disposed = false;

  const update = (clock: ClockSnapshot): void => {
    if (active && clock.trackId === trackId && view.update(clock.positionSeconds * 1000)) onLayoutChange();
  };
  const ensure = async (): Promise<void> => {
    if (disposed || !active || !trackId || loadedId === trackId || pending) return;
    const id = trackId, request = generation;
    pending = true;
    message.hidden = false;
    message.textContent = '正在加载歌词…';
    onLayoutChange();
    try {
      const lyrics = await host.getLyrics(id);
      if (disposed || request !== generation) return;
      loadedId = id;
      const timeline = buildLyricsTimeline(lyrics);
      view.setTimeline(timeline);
      message.hidden = timeline.kind !== 'empty';
      message.textContent = timeline.kind === 'empty' ? '暂无歌词' : '';
      update(host.readClock());
      onLayoutChange();
    } catch {
      if (disposed || request !== generation) return;
      loadedId = id;
      failed = true;
      message.textContent = '歌词加载失败，重新打开可重试';
      onLayoutChange();
    } finally {
      pending = false;
      // Rapid skips coalesce to the latest track instead of queuing a read for every song.
      void ensure();
    }
  };

  return {
    element,
    viewElement: view.element,
    hasFollowingLine: view.hasFollowingLine,
    setTrack(id: string | null) {
      if (disposed || id === trackId) return;
      generation++;
      trackId = id;
      loadedId = null;
      failed = false;
      view.setTimeline(null);
      message.hidden = false;
      message.textContent = id ? '正在加载歌词…' : '正在同步歌曲…';
      onLayoutChange();
      void ensure();
    },
    setActive(enabled: boolean) {
      if (disposed || active === enabled) return;
      active = enabled;
      if (enabled && failed) { loadedId = null; failed = false; }
      void ensure();
      if (enabled) update(host.readClock());
    },
    setOptions(options: LyricsViewOptions) {
      view.setOptions(options);
      onLayoutChange();
    },
    update,
    dispose() {
      disposed = true;
      generation++;
      trackId = loadedId = null;
      view.dispose();
      element.remove();
    },
  };
}
