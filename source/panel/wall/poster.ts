/**
 * One poster card: pure presentation helpers (unit-tested in Node) plus the DOM factory and the
 * incremental writers used by `posterWall.ts`. Nothing here touches `document` at module scope so
 * the pure helpers can be imported from Node tests.
 */

import type { ExpandedContent, GridRect, PixelRect, Tile } from '../types.ts';
import { createCoverSwapQueue, createPosterCover, type CoverSwapQueue, type PosterCover } from './posterCover.ts';

export const ENTRANCE_STEP_SECONDS = 0.034;
export const ENTRANCE_MAX_SECONDS = 0.34;

// ---------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------

function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  let mixed = value ^ (value >>> 16);
  mixed = Math.imul(mixed, 0x45d9f3b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/**
 * Deterministic two-colour gradient for tiles without cover art. Hues are at least 40° apart and
 * saturation/lightness stay in a band that keeps white overlay text readable.
 */
export function fallbackGradient(trackId: string): string {
  const first = hash32(trackId);
  const second = mix32(first);
  const hue1 = first % 360;
  const spread = 40 + ((first >>> 9) % 140);
  const hue2 = (hue1 + spread) % 360;
  const sat1 = 45 + ((first >>> 17) % 21);
  const sat2 = 45 + (second % 21);
  const light1 = 28 + ((first >>> 25) % 21);
  const light2 = 28 + ((second >>> 8) % 21);
  return `linear-gradient(135deg, hsl(${hue1} ${sat1}% ${light1}%), hsl(${hue2} ${sat2}% ${light2}%))`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`;
  return `${minutes}:${rest}`;
}

/** Diagonal wave delay: grid steps from the viewport's top-left corner, capped (SPEC §2.1, §6). */
export function entranceDelaySeconds(rect: GridRect, leftCol: number, topRow: number): number {
  const steps = Math.max(0, rect.col - leftCol + (rect.row - topRow));
  const delay = Math.min(ENTRANCE_MAX_SECONDS, steps * ENTRANCE_STEP_SECONDS);
  return Math.round(delay * 1000) / 1000;
}

/** Scale factors that grow a card by exactly one gap on each axis (SPEC §2.2). */
export function hoverScale(rectPx: PixelRect, gap: number): { x: number; y: number } {
  return {
    x: rectPx.w > 0 ? (rectPx.w + gap) / rectPx.w : 1,
    y: rectPx.h > 0 ? (rectPx.h + gap) / rectPx.h : 1,
  };
}

// ---------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------

export type PosterElement = {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly cover: HTMLImageElement;
  readonly coverLoader: PosterCover;
  readonly fallback: HTMLElement;
  readonly caption: HTMLElement;
  readonly captionTitle: HTMLElement;
  readonly captionArtist: HTMLElement;
  /** Rect last written to the inline style; `applyRect` compares against it to skip redundant writes. */
  readonly rect: PixelRect;
  expanded: ExpandedContent | null;
  /** Primitive snapshot of what the DOM currently shows, so `applyTile` only writes real changes. */
  readonly shown: {
    /** The tile's cover URL (host thumb variant). */
    coverUrl: string | null;
    /** Card box in CSS px (target rect, not spring frames); picks the cover variant with the expanded state. */
    box: { w: number; h: number };
    scale: number;
    trackId: string | null;
    label: string;
    current: boolean;
    hoverGap: number;
  };
};

function createDiv(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

const LOCAL_COVER_VARIANT = /^echo-cover:\/\/(?:thumb|album|large)\//u;
/** Above this many device pixels on the longest side, ECHO's 320 px `album` variant visibly blurs. */
export const ALBUM_VARIANT_MAX_DEVICE_PX = 480;

export type CoverVariant = 'thumb' | 'album' | 'large';

/**
 * The host hands out the small `thumb` variant (≈ 96 px) of local covers, which blurs on wall cards that
 * are 260 px and up. The same id also serves ECHO's `album` (≈ 320 px, what its grid cards decode) and
 * `large` (≈ 768 px, what its track views decode) variants. Non-local URLs pass through unchanged.
 */
export function coverVariantUrl(url: string, variant: CoverVariant): string {
  return LOCAL_COVER_VARIANT.test(url) ? url.replace(LOCAL_COVER_VARIANT, `echo-cover://${variant}/`) : url;
}

/** Select from displayed pixels, retaining the large variant near the boundary to avoid churn. */
export function coverVariantFor(
  box: { w: number; h: number }, _expanded: boolean, devicePixelRatio = 1, scale = 1, previous?: CoverVariant,
): CoverVariant {
  const pixels = Math.max(box.w, box.h) * devicePixelRatio * scale;
  const threshold = previous === 'large' ? ALBUM_VARIANT_MAX_DEVICE_PX * 0.85 : ALBUM_VARIANT_MAX_DEVICE_PX;
  return pixels > threshold ? 'large' : 'album';
}

/** Budgeted after geometry settles; the wall also limits temporary decode-and-swap work. */
export function syncPosterCover(el: PosterElement, commit = true): boolean {
  const base = el.shown.coverUrl;
  const dpr = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  const previous = el.coverLoader.source?.startsWith('echo-cover://large/') ? 'large' : undefined;
  const src = base === null ? null : coverVariantUrl(base,
    coverVariantFor(el.shown.box, el.expanded !== null, dpr, el.shown.scale, previous));
  if (el.coverLoader.matches(src)) return false;
  if (!commit) return true;
  el.coverLoader.request(src, base);
  return true;
}

export function createPosterElement(coverQueue: CoverSwapQueue = createCoverSwapQueue()): PosterElement {
  const root = document.createElement('article');
  root.className = 'poster';
  root.setAttribute('role', 'button');
  root.tabIndex = -1;

  const body = createDiv('poster__body');
  const coverLoader = createPosterCover(coverQueue);
  const cover = coverLoader.image;
  const fallback = createDiv('poster__fallback');
  // The fallback precedes the cover so the image paints above the gradient in plain DOM order.
  body.append(fallback, cover, createDiv('poster__shade'), createDiv('poster__tint'), createDiv('poster__lights'));
  const caption = createDiv('poster__caption');
  const captionTitle = createDiv('poster__caption-title');
  const captionArtist = createDiv('poster__caption-artist');
  caption.append(captionTitle, captionArtist);
  caption.hidden = true;
  // The card already exposes the full title and artist through its accessible label.
  caption.setAttribute('aria-hidden', 'true');
  root.append(body, caption);

  const el: PosterElement = {
    root,
    body,
    get cover() { return coverLoader.image; },
    coverLoader,
    fallback,
    caption,
    captionTitle,
    captionArtist,
    rect: { x: NaN, y: NaN, w: NaN, h: NaN },
    expanded: null,
    shown: { coverUrl: null, box: { w: 0, h: 0 }, scale: 1, trackId: null, label: '', current: false, hoverGap: NaN },
  };
  return el;
}

/** Record target size; image selection is deferred until geometry settles. */
export function applyCardBox(el: PosterElement, box: { w: number; h: number }): void {
  const shown = el.shown;
  if (shown.box.w === box.w && shown.box.h === box.h) return;
  shown.box = { w: box.w, h: box.h };
  // Reserve the bottom inset and artist line; short cards show fewer title lines.
  el.root.style.setProperty('--caption-lines', String(Math.max(1, Math.min(3, Math.floor((box.h - 50) / 35.2)))));
  // Cover changes are flushed with a separate per-frame budget after motion settles.
}

export function applyTile(el: PosterElement, tile: Tile | undefined, isCurrent: boolean): void {
  const shown = el.shown;

  const coverUrl = tile?.coverUrl ?? null;
  if (coverUrl !== shown.coverUrl) {
    shown.coverUrl = coverUrl;
    el.root.dataset.squareCover = String(coverUrl !== null && LOCAL_COVER_VARIANT.test(coverUrl));
    syncPosterCover(el);
  }

  const trackId = tile ? tile.trackId : null;
  if (trackId !== shown.trackId) {
    shown.trackId = trackId;
    el.fallback.style.background = trackId === null ? '' : fallbackGradient(trackId);
  }

  const label = tile ? (tile.artist ? `${tile.title} · ${tile.artist}` : tile.title) : '';
  if (label !== shown.label) {
    shown.label = label;
    el.root.setAttribute('aria-label', label);
  }

  const title = tile?.title ?? '';
  if (el.captionTitle.textContent !== title) {
    el.captionTitle.textContent = title;
    el.root.title = title;
  }
  const artist = tile?.artist ?? '';
  if (el.captionArtist.textContent !== artist) el.captionArtist.textContent = artist;
  el.caption.hidden = !title;

  if (isCurrent !== shown.current) {
    shown.current = isCurrent;
    if (isCurrent) el.root.dataset.current = 'true';
    else delete el.root.dataset.current;
  }

  if (el.expanded) fillMeta(el.expanded, tile);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function applyRect(el: PosterElement, rect: PixelRect, gap: number, moving = false): void {
  const last = el.rect;
  const style = el.root.style;
  const x = round2(rect.x);
  const y = round2(rect.y);
  // Whole-pixel sizes avoid a layout on every subpixel spring tail; the settled write is exact.
  const w = moving ? Math.round(rect.w) : round2(rect.w);
  const h = moving ? Math.round(rect.h) : round2(rect.h);

  if (x !== last.x || y !== last.y) {
    last.x = x;
    last.y = y;
    style.transform = `translate(${x}px, ${y}px)`;
  }
  let sizeChanged = false;
  if (w !== last.w) {
    last.w = w;
    sizeChanged = true;
    style.width = `${w}px`;
  }
  if (h !== last.h) {
    last.h = h;
    sizeChanged = true;
    style.height = `${h}px`;
  }
  if (sizeChanged || gap !== el.shown.hoverGap) {
    // Local thumbnails are square crops; keep the same crop when the full-aspect large image arrives.
    style.setProperty('--cover-side', `${Math.max(w, h)}px`);
    el.shown.hoverGap = gap;
    const scale = hoverScale(last, gap);
    style.setProperty('--hx', scale.x.toFixed(4));
    style.setProperty('--hy', scale.y.toFixed(4));
  }
}

function fillMeta(content: ExpandedContent, tile: Tile | undefined): void {
  const title = content.meta.firstElementChild;
  const artist = content.meta.lastElementChild;
  const titleText = tile ? tile.title : '';
  const artistText = tile ? (tile.album ? `${tile.artist} · ${tile.album}` : tile.artist) : '';
  if (title && title.textContent !== titleText) title.textContent = titleText;
  if (artist && artist.textContent !== artistText) artist.textContent = artistText;
}

export function buildExpandedContent(el: PosterElement, tile: Tile | undefined): ExpandedContent {
  if (!el.expanded) {
    const root = createDiv('poster__expanded');
    const meta = createDiv('poster__meta');
    const title = document.createElement('h1');
    title.className = 'poster__title';
    const artist = document.createElement('p');
    artist.className = 'poster__artist';
    meta.append(title, artist);
    const controls = createDiv('poster__controls');
    const lyrics = createDiv('poster__lyrics');
    root.append(meta, controls, lyrics);
    el.root.append(root);
    el.expanded = { root, meta, controls, lyrics };
  }
  fillMeta(el.expanded, tile);
  el.root.setAttribute('role', 'group');
  return el.expanded;
}

export function removeExpandedContent(el: PosterElement): void {
  if (!el.expanded) return;
  const active = document.activeElement;
  const restore = Boolean(active && el.expanded.root.contains(active));
  el.expanded.root.remove();
  el.expanded = null;
  el.root.setAttribute('role', 'button');
  if (!restore) return;
  // Keep DOM focus on the field after collapse so a leftover card focus cannot look selected.
  if (el.root.dataset.expanded === 'true') {
    el.root.focus({ preventScroll: true });
    return;
  }
  el.root.closest<HTMLElement>('.field')?.focus({ preventScroll: true });
}

/**
 * Strip the per-instance presentation state (expansion, focus, entrance classes) so the element can be
 * pointed at another instance in place. Tile content and the geometry cache are left alone: `applyTile`
 * and `applyRect` only write what actually differs for the next instance.
 */
export function clearPosterInstance(el: PosterElement): void {
  removeExpandedContent(el);
  const root = el.root;
  root.className = 'poster';
  root.tabIndex = -1;
  delete root.dataset.instance;
  delete root.dataset.expanded;
  delete root.dataset.settled;
  delete root.dataset.focused;
  delete root.dataset.lyrics;
  root.style.removeProperty('--enter-delay');
}

/** Return a card to the free list: clear instance state and drop the cover so parked cards hold no image. */
export function resetPosterElement(el: PosterElement): void {
  clearPosterInstance(el);
  if (el.shown.current) {
    el.shown.current = false;
    delete el.root.dataset.current;
  }
  el.shown.coverUrl = null;
  el.coverLoader.clear();
  el.shown.box = { w: 0, h: 0 };
}
