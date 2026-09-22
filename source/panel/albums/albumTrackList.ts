import { formatTime } from '../wall/poster.ts';
import { TRACK_PAGE_SIZE } from './albumModel.ts';

const OVERSCAN = 5;
const MAX_ROWS = 50;

/** A continuous scrollbar backed by at most two visible pages and one pending read. */
export function createAlbumTrackList(api: EchoWorkshopApi, onPlay: (id: string) => void, onMessage: (text: string) => void) {
  const element = document.createElement('div');
  element.className = 'album-tracks'; element.dataset.scrollable = 'true';
  element.tabIndex = -1;
  element.setAttribute('aria-label', '专辑曲目');
  const top = document.createElement('div');
  const rows = document.createElement('div'); rows.className = 'album-tracks__rows';
  const bottom = document.createElement('div');
  for (const spacer of [top, bottom]) spacer.setAttribute('aria-hidden', 'true');
  element.append(top, rows, bottom);
  const abort = new AbortController();
  const pages = new Map<number, EchoWorkshopTrack[]>();
  const failures = new Set<number>();
  const mounted = new Map<number, HTMLElement>();
  let albumId: string | null = null, currentId: string | null = null;
  let total = 0, generation = 0, frame = 0, pending: Promise<void> | null = null;
  let firstPage = 1, lastPage = 1, previousRange = '', revision = 0;
  let initial = true;
  let keyboardTarget: number | null = null, keyboardDirection = 1;

  const schedule = () => { if (!frame && albumId) frame = requestAnimationFrame(render); };
  const markCurrent = () => {
    for (const button of rows.querySelectorAll<HTMLButtonElement>('button[data-track]')) {
      if (button.dataset.track === currentId) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  };
  const getTrack = (index: number) => pages.get(Math.floor(index / TRACK_PAGE_SIZE) + 1)?.[index % TRACK_PAGE_SIZE];
  const putRow = (index: number, row: HTMLElement) => {
    const previous = mounted.get(index);
    const focused = previous === document.activeElement;
    if (previous) previous.replaceWith(row); else rows.append(row);
    mounted.set(index, row);
    if (focused) (row instanceof HTMLButtonElement ? row : element).focus({ preventScroll: true });
  };

  function readNext(): void {
    if (pending || !albumId) return;
    const page = Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage + i)
      .find(value => !pages.has(value) && !failures.has(value));
    if (page === undefined) return;
    const request = generation, id = albumId;
    element.setAttribute('aria-busy', 'true');
    const task = (async () => {
      try {
        const result = await api.library.getAlbumTracks(id, { page, pageSize: TRACK_PAGE_SIZE });
        if (request !== generation) return;
        total = Math.max(0, result.total);
        // A fast scroll may move past this request before it completes; do not retain it.
        if (page >= firstPage && page <= lastPage) pages.set(page, result.items.slice(0, TRACK_PAGE_SIZE));
        if (initial) { initial = false; onMessage(total ? `${total} 首曲目` : '这张专辑没有可用曲目。'); }
      } catch {
        if (request === generation && page >= firstPage && page <= lastPage) failures.add(page);
      } finally {
        if (request === generation) { revision++; schedule(); }
      }
    })();
    pending = task;
    void task.finally(() => {
      if (pending === task) pending = null;
      element.removeAttribute('aria-busy');
      schedule();
    });
  }

  function render(): void {
    frame = 0;
    if (!albumId || element.clientHeight === 0) return;
    const scale = Number.parseFloat(getComputedStyle(element).getPropertyValue('--album-scale')) || 1;
    const rowHeight = 44 / scale;
    element.style.setProperty('--album-track-height', `${rowHeight}px`);
    if (keyboardTarget !== null) {
      while (keyboardTarget >= 0 && keyboardTarget < total && getTrack(keyboardTarget)?.unavailable) keyboardTarget += keyboardDirection;
      if (keyboardTarget < 0 || keyboardTarget >= total) keyboardTarget = null;
      else if (keyboardTarget * rowHeight < element.scrollTop) element.scrollTop = keyboardTarget * rowHeight;
      else if ((keyboardTarget + 1) * rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = (keyboardTarget + 1) * rowHeight - element.clientHeight;
    }
    const count = Math.max(total, initial ? 1 : 0);
    const visible = Math.min(MAX_ROWS, Math.ceil(element.clientHeight / rowHeight) + OVERSCAN * 2);
    const start = Math.max(0, Math.min(count - 1, Math.floor(element.scrollTop / rowHeight) - OVERSCAN));
    const end = Math.min(count, start + visible);
    firstPage = Math.floor(start / TRACK_PAGE_SIZE) + 1;
    lastPage = Math.max(firstPage, Math.ceil(end / TRACK_PAGE_SIZE));
    for (const page of pages.keys()) if (page < firstPage || page > lastPage) pages.delete(page);
    for (const page of failures) if (page < firstPage || page > lastPage) failures.delete(page);
    const range = `${start}:${end}:${revision}`;
    if (range !== previousRange) {
      for (const [index, row] of mounted) {
        if (index < start || index >= end) { row.remove(); mounted.delete(index); }
      }
      let lastPlaceholderPage = -1;
      for (let index = start; index < end; index++) {
        const track = getTrack(index);
        const page = Math.floor(index / TRACK_PAGE_SIZE) + 1;
        if (!track) {
          const failed = failures.has(page);
          const firstPlaceholder = lastPlaceholderPage !== page;
          const row = document.createElement(failed && firstPlaceholder ? 'button' : 'div');
          row.className = 'album-track-row album-tracks__placeholder';
          if (row instanceof HTMLButtonElement) {
            row.type = 'button'; row.dataset.retryPage = String(page);
            row.textContent = '加载失败，点击重试';
          } else {
            row.textContent = !failed && firstPlaceholder ? '正在加载…' : '';
            row.setAttribute('aria-hidden', 'true');
          }
          lastPlaceholderPage = page; putRow(index, row); continue;
        }
        if (mounted.get(index)?.dataset.track === track.id) continue;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'album-track-row'; button.dataset.track = track.id;
        button.dataset.index = String(index);
        button.disabled = track.unavailable;
        const number = document.createElement('span'); number.className = 'album-track__number';
        number.textContent = String(index + 1).padStart(2, '0');
        const title = document.createElement('span'); title.className = 'album-track__title'; title.textContent = track.title || '未知标题';
        const time = document.createElement('span'); time.className = 'album-track__time';
        time.textContent = track.unavailable ? '不可用' : formatTime(track.durationSeconds);
        button.append(number, title, time); putRow(index, button);
      }
      top.style.height = `${start * rowHeight}px`;
      bottom.style.height = `${Math.max(0, count - end) * rowHeight}px`;
      // Insert new edges in order without detaching retained rows or their keyboard focus.
      let cursor = rows.firstElementChild;
      for (let index = start; index < end; index++) {
        const row = mounted.get(index)!;
        if (row === cursor) cursor = cursor.nextElementSibling;
        else rows.insertBefore(row, cursor);
      }
      previousRange = range;
      markCurrent();
    } else {
      top.style.height = `${start * rowHeight}px`;
      bottom.style.height = `${Math.max(0, count - end) * rowHeight}px`;
    }
    readNext();
    if (keyboardTarget !== null) {
      const failedPage = Math.floor(keyboardTarget / TRACK_PAGE_SIZE) + 1;
      const target = failures.has(failedPage)
        ? rows.querySelector<HTMLButtonElement>(`button[data-retry-page="${failedPage}"]`)
        : mounted.get(keyboardTarget);
      if (target instanceof HTMLButtonElement) { keyboardTarget = null; target.focus({ preventScroll: true }); }
      else if (!element.contains(document.activeElement)) element.focus({ preventScroll: true });
    }
  }

  element.addEventListener('scroll', schedule, { passive: true, signal: abort.signal });
  element.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
    if (!button && keyboardTarget === null) return;
    keyboardDirection = event.shiftKey ? -1 : 1;
    let next = (keyboardTarget ?? Number(button!.dataset.index)) + keyboardDirection;
    while (next >= 0 && next < total && getTrack(next)?.unavailable) next += keyboardDirection;
    if (next < 0 || next >= total) return;
    event.preventDefault(); keyboardTarget = next;
    // Keep the logical destination while its data loads instead of tabbing past unloaded rows.
    if (frame) cancelAnimationFrame(frame);
    render();
  }, { signal: abort.signal });
  for (const name of ['pointerdown', 'wheel']) element.addEventListener(name, () => { keyboardTarget = null; }, { passive: true, signal: abort.signal });
  element.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !element.contains(event.relatedTarget)) keyboardTarget = null;
  }, { signal: abort.signal });
  element.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (button?.dataset.retryPage) { failures.delete(Number(button.dataset.retryPage)); revision++; schedule(); }
    const id = button?.dataset.track;
    if (id && !button.disabled && Array.from(pages.values()).some(tracks => tracks.some(track => track.id === id && !track.unavailable))) onPlay(id);
  }, { signal: abort.signal });
  const resize = new ResizeObserver(schedule); resize.observe(element);
  function clear(): void {
    generation++; albumId = null; total = 0; initial = true;
    keyboardTarget = null;
    pages.clear(); failures.clear(); mounted.clear(); rows.replaceChildren(); previousRange = ''; revision++;
    top.style.height = '0px'; bottom.style.height = '0px'; element.scrollTop = 0;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    element.removeAttribute('aria-busy');
  }
  return {
    element,
    mount(album: EchoWorkshopAlbum) {
      clear(); albumId = album.id; total = album.trackCount;
      onMessage('正在加载曲目…'); schedule();
    },
    setCurrent(id: string | null) { if (id !== currentId) { currentId = id; markCurrent(); } },
    clear,
    dispose() { clear(); abort.abort(); resize.disconnect(); },
  };
}
