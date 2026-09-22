import type { ClockSnapshot, ExpandedContent } from '../types.ts';
import { createAlbumActions, type AlbumActionHandlers } from './albumActions.ts';
import { createAlbumTrackList } from './albumTrackList.ts';

export type AlbumDetailsHost = AlbumActionHandlers;

/** One expanded album owns a bounded scrolling list and a single set of playback controls. */
export function createAlbumDetails(api: EchoWorkshopApi, host: AlbumDetailsHost) {
  const element = document.createElement('div');
  element.className = 'album-details';
  element.dataset.scrollable = 'true';
  const message = document.createElement('p');
  message.className = 'album-details__message';
  message.setAttribute('role', 'status');
  let album: EchoWorkshopAlbum | null = null;
  let generation = 0;
  let busy = false;
  let currentTrackId: string | null = null;
  let thisAlbum = false;
  const abort = new AbortController();
  const { signal } = abort;
  const run = async (action: () => Promise<unknown>, success = '已开始播放') => {
    if (busy) return;
    const request = generation;
    busy = true;
    element.setAttribute('aria-busy', 'true');
    message.textContent = '正在开始播放…';
    try {
      const result = await action() as EchoWorkshopCollectionPlayResult;
      if (request === generation) message.textContent = typeof result?.count === 'number' ? `已播放 ${result.count} 首` : success;
    } catch {
      if (request === generation) message.textContent = '播放失败，请重试或在 ECHO 中检查歌曲是否可用。';
    } finally {
      if (request === generation) {
        busy = false;
        element.removeAttribute('aria-busy');
      }
    }
  };
  const wrapped: AlbumActionHandlers = {
    playAlbum: () => {
      if (!album || album.trackCount === 0) return;
      const id = album.id;
      void run(() => api.queue.playAlbum(id));
    },
    play: () => host.play(),
    pause: () => host.pause(),
    togglePlay: () => host.togglePlay(),
    previous: () => host.previous(),
    next: () => host.next(),
    seek: (position) => host.seek(position),
    toggleShuffle: () => host.toggleShuffle(),
    toggleRepeatOne: () => host.toggleRepeatOne(),
  };
  const cluster = createAlbumActions(wrapped);
  const tracks = createAlbumTrackList(api, (id) => void run(() => api.queue.playTrack(id)), (text) => {
    message.textContent = text;
  });
  element.append(message, tracks.element);

  const applyMode = (): void => {
    cluster.setMode(thisAlbum && currentTrackId !== null ? 'current' : 'other');
  };

  for (const node of [element, cluster.element]) {
    for (const name of ['pointerdown', 'click']) node.addEventListener(name, (event) => event.stopPropagation(), { signal });
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') event.stopPropagation();
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code !== 'Space' && event.key !== ' ') return;
      const target = event.target instanceof Element ? event.target : null;
      const track = target?.closest<HTMLButtonElement>('button[data-track]');
      if (!thisAlbum || !track || track.disabled || track.dataset.track !== currentTrackId) return;
      event.preventDefault();
      host.togglePlay();
    }, { signal });
  }

  const clear = (): void => {
    generation += 1;
    tracks.clear();
    album = null;
    busy = false;
    element.hidden = false;
    cluster.element.hidden = false;
    element.removeAttribute('aria-busy');
    element.remove();
    cluster.element.remove();
  };

  return {
    mount(content: ExpandedContent, nextAlbum: EchoWorkshopAlbum, currentAlbum: boolean) {
      clear();
      album = nextAlbum;
      thisAlbum = currentAlbum;
      content.root.classList.add('poster__expanded--album');
      content.lyrics.replaceChildren(element);
      content.controls.replaceChildren(cluster.element);
      tracks.mount(nextAlbum);
      applyMode();
    },
    updateCurrent(id: string | null, currentAlbum: boolean) {
      currentTrackId = id;
      thisAlbum = currentAlbum;
      tracks.setCurrent(id);
      applyMode();
    },
    updateStatus(status: EchoWorkshopPlaybackStatus, currentAlbum: boolean) {
      currentTrackId = status.currentTrackId;
      thisAlbum = currentAlbum;
      tracks.setCurrent(currentTrackId);
      applyMode();
    },
    updateClock(snapshot: ClockSnapshot) {
      if (thisAlbum) cluster.update(snapshot);
    },
    setShuffleEnabled(enabled: boolean) {
      cluster.setShuffleEnabled(enabled);
    },
    setRepeatOne(enabled: boolean) {
      cluster.setRepeatOne(enabled);
    },
    play() {
      wrapped.playAlbum();
    },
    toggle() {
      element.hidden = !element.hidden;
      cluster.element.hidden = element.hidden;
    },
    focusSeek() {
      return cluster.focusSeek();
    },
    get seekFocused() {
      return cluster.seekFocused;
    },
    clear() {
      clear();
      element.hidden = false;
      cluster.element.hidden = false;
    },
    dispose() {
      clear();
      tracks.dispose();
      abort.abort();
    },
  };
}
