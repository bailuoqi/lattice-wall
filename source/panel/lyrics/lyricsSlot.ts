/**
 * Lyrics slot sizing for the expanded card. The view can paint current + next after the first
 * open measure; keep a following-row reserve so the slot does not lock to one line.
 */

export const LYRICS_LINE_MIN_PX = 8;

export function resolveLyricsOpenHeight(input: {
  cap: number;
  scrollHeight: number;
  rowHeights: number[];
  gap: number;
  expectNext: boolean;
  estimatedCurrent: number;
  estimatedNext: number;
}): number {
  if (!(input.cap > 1)) return 0;
  const currentH = input.rowHeights[0] ?? 0;
  if (!input.expectNext) return Math.min(Math.max(0, currentH), input.cap);
  const measuredRows = input.rowHeights.filter((height) => height > 0);
  const rows = measuredRows.reduce((sum, height) => sum + height, 0);
  const rowGap = input.gap * Math.max(0, measuredRows.length - 1);
  const reserved = Math.max(currentH, input.estimatedCurrent) + Math.max(input.rowHeights[1] ?? 0, input.estimatedNext) + input.gap;
  return Math.min(Math.max(0, input.scrollHeight, rows + rowGap, reserved), input.cap);
}

export function estimateLyricsLineHeight(row: HTMLElement | null, fallback: number): number {
  if (!row) return fallback;
  const text = row.querySelector<HTMLElement>('.lyrics__text');
  const style = getComputedStyle(text ?? row);
  const font = Number.parseFloat(style.fontSize) || 0;
  const line = Number.parseFloat(style.lineHeight) || font * 1.25;
  const min = Number.parseFloat(style.minHeight) || 0;
  return Math.max(font, Number.isFinite(line) ? line : 0, Number.isFinite(min) ? min : 0, fallback);
}

export function measureLyricsOpenHeight(card: HTMLElement, slot: HTMLElement, expectNext: boolean): number {
  const cap = card.offsetHeight * 0.42;
  if (cap <= 1) return 0;
  const lyrics = slot.firstElementChild instanceof HTMLElement ? slot.firstElementChild : null;
  const prevSlotMax = slot.style.maxHeight;
  const prevSlotHeight = slot.style.height;
  const prevLyricsHeight = lyrics?.style.height ?? '';
  const prevLyricsOverflow = lyrics?.style.overflow ?? '';
  slot.style.maxHeight = `${cap}px`;
  slot.style.height = 'auto';
  if (lyrics) {
    lyrics.style.height = 'auto';
    lyrics.style.overflow = 'visible';
  }
  const current = lyrics?.querySelector<HTMLElement>('.lyrics__line--current') ?? null;
  const next = lyrics?.querySelector<HTMLElement>('.lyrics__line--next') ?? null;
  const gap = lyrics ? Number.parseFloat(getComputedStyle(lyrics).rowGap) || 0 : 0;
  const rowHeights: number[] = [];
  // CSS layout pixels, including fractions; client rects include the wall camera's scale.
  // offsetHeight would round off the bottom of the last line when the slot has no reserve.
  const rowHeight = (row: HTMLElement): number => row.hidden ? 0 : Number.parseFloat(getComputedStyle(row).height) || 0;
  if (current) rowHeights.push(rowHeight(current));
  if (next) rowHeights.push(rowHeight(next));
  const height = resolveLyricsOpenHeight({
    cap,
    scrollHeight: Math.max(slot.scrollHeight, lyrics?.scrollHeight ?? 0),
    rowHeights,
    gap,
    expectNext,
    estimatedCurrent: estimateLyricsLineHeight(current, 40),
    estimatedNext: estimateLyricsLineHeight(next, 28),
  });
  slot.style.maxHeight = prevSlotMax;
  slot.style.height = prevSlotHeight;
  if (lyrics) {
    lyrics.style.height = prevLyricsHeight;
    lyrics.style.overflow = prevLyricsOverflow;
  }
  return height;
}

export function lyricsContentReady(slot: HTMLElement, expectNext: boolean): boolean {
  const root = slot.firstElementChild;
  if (!(root instanceof HTMLElement) || root.hidden) return false;
  if (root.querySelector('.lyrics__plain, .lyrics__instrumental')) return true;
  const current = root.querySelector<HTMLElement>('.lyrics__line--current');
  const next = root.querySelector<HTMLElement>('.lyrics__line--next');
  const currentText = current?.querySelector('.lyrics__text')?.textContent?.trim() ?? '';
  const nextText = next?.querySelector('.lyrics__text')?.textContent?.trim() ?? '';
  const currentReady = Boolean(current && currentText && current.offsetHeight >= LYRICS_LINE_MIN_PX);
  const nextReady = Boolean(next && nextText && next.offsetHeight >= LYRICS_LINE_MIN_PX);
  // Before the first line the upcoming lyric sits in the next row.
  if (!currentReady) return nextReady;
  return !expectNext || nextReady;
}

export function clearLyricsSlotSize(slot: HTMLElement): void {
  slot.style.height = '';
  slot.style.maxHeight = '';
}

export function commitLyricsSlotSize(slot: HTMLElement, height: number): void {
  slot.style.height = `${height}px`;
  slot.style.maxHeight = `${height}px`;
}
