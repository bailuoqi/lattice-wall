import type { ClockSnapshot, ExpandedContent, LyricsViewOptions } from '../types.ts';
import { createAlbumActions, type AlbumActionHandlers } from './albumActions.ts';
import { createAlbumTrackList } from './albumTrackList.ts';
import { createAlbumLyrics, type AlbumLyricsHost } from './albumLyrics.ts';
import { createAlbumLayout, type AlbumContentMode } from './albumLayout.ts';

export type AlbumDetailsHost = AlbumActionHandlers & AlbumLyricsHost;

/** One expanded album owns a bounded scrolling list and a single set of playback controls. */
export function createAlbumDetails(api: EchoWorkshopApi, host: AlbumDetailsHost) {
  const element = document.createElement('div');
  element.className = 'album-details';
  element.dataset.scrollable = 'true';
  element.id = `album-tracks-${crypto.randomUUID()}`;
  const message = document.createElement('p');
  message.className = 'album-details__message';
  message.setAttribute('role', 'status');
  let album: EchoWorkshopAlbum | null = null;
  let generation = 0;
  let busy = false;
  let currentTrackId: string | null = null;
  let metadataTrackId: string | null = null;
  let thisAlbum = false;
  let contentMode: AlbumContentMode = 'none';
  let lastOpenMode: Exclude<AlbumContentMode, 'none'> = 'tracks';
  let contentSlot: HTMLElement | null = null;
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
  const cluster = createAlbumActions(wrapped,
    () => setContentMode(contentMode === 'tracks' ? 'none' : 'tracks'),
    () => setContentMode(contentMode === 'lyrics' ? 'none' : 'lyrics'));
  cluster.tracksToggle.setAttribute('aria-controls', element.id);
  const lyrics = createAlbumLyrics(host, () => layout.refreshLyrics());
  const layout = createAlbumLayout(lyrics);
  cluster.lyricsToggle.setAttribute('aria-controls', lyrics.element.id);
  const tracks = createAlbumTrackList(api, (id) => void run(() => api.queue.playTrack(id)), (text) => {
    message.textContent = text;
  });
  element.append(message, tracks.element);

  const setContentMode = (mode: AlbumContentMode): void => {
    contentMode = mode;
    if (mode !== 'none') lastOpenMode = mode;
    if (contentSlot) contentSlot.dataset.albumView = mode;
    // A single mode controls both panels. Keep list position while removing hidden rows from focus.
    const panels = [
      { panel: element, button: cluster.tracksToggle, open: mode === 'tracks', label: mode === 'tracks' ? '收起曲目列表' : '展开曲目列表' },
      { panel: lyrics.element, button: cluster.lyricsToggle, open: mode === 'lyrics', label: mode === 'lyrics' ? '隐藏歌词' : '显示歌词' },
    ];
    for (const { panel, button, open, label } of panels) {
      if (!open && panel.contains(document.activeElement)) {
        (button.hidden ? cluster.tracksToggle : button).focus({ preventScroll: true });
      }
      panel.inert = !open;
      panel.setAttribute('aria-hidden', String(!open));
      panel.dataset.open = String(open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    lyrics.setActive(mode === 'lyrics' && album !== null && thisAlbum);
    layout.setMode(mode);
  };
  setContentMode(contentMode);

  const applyMode = (): void => {
    const current = thisAlbum && currentTrackId !== null;
    cluster.setMode(current ? 'current' : 'other');
    // Playback status and queue metadata can arrive in either order. Never put another album's
    // lyrics on this cover while waiting for the matching metadata / authoritative clock.
    const confirmed = current && currentTrackId === metadataTrackId && host.readClock().trackId === currentTrackId;
    lyrics.setTrack(album && confirmed ? currentTrackId : null);
    if (!current && contentMode === 'lyrics') setContentMode('tracks');
    else setContentMode(contentMode);
  };

  for (const node of [element, lyrics.element, cluster.element]) {
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
    layout.reset();
    lyrics.setActive(false);
    lyrics.setTrack(null);
    lyrics.element.remove();
    tracks.clear();
    album = null;
    busy = false;
    element.removeAttribute('aria-busy');
    element.remove();
    cluster.element.remove();
    contentSlot = null;
  };

  return {
    mount(content: ExpandedContent, nextAlbum: EchoWorkshopAlbum, currentAlbum: boolean) {
      clear();
      album = nextAlbum;
      thisAlbum = currentAlbum;
      content.root.classList.add('poster__expanded--album');
      contentSlot = content.lyrics;
      content.lyrics.replaceChildren(element, lyrics.element);
      content.controls.replaceChildren(cluster.element);
      layout.mount(content);
      tracks.mount(nextAlbum);
      applyMode();
    },
    updateCurrent(id: string | null, currentAlbum: boolean) {
      metadataTrackId = id;
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
      lyrics.update(snapshot);
    },
    setLyricsOptions(options: LyricsViewOptions) {
      lyrics.setOptions(options);
      layout.setReducedMotion(options.reducedMotion);
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
      const next = contentMode === 'none' ? lastOpenMode : 'none';
      setContentMode(next === 'lyrics' && !thisAlbum ? 'tracks' : next);
    },
    focusSeek() {
      return cluster.focusSeek();
    },
    get clockVisible() {
      return cluster.element.isConnected;
    },
    get seekFocused() {
      return cluster.seekFocused;
    },
    clear() {
      clear();
    },
    dispose() {
      clear();
      tracks.dispose();
      lyrics.dispose();
      abort.abort();
    },
  };
}
