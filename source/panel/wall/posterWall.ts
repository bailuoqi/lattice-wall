/**
 * Poster wall renderer (SPEC §2.2, §2.3, §6): owns the `.poster` pool inside `.world`, culls it
 * against the camera, animates rect changes with rect springs and raises user intent to `main.ts`
 * through `PosterWallHandlers`. It never talks to the host and never moves the camera.
 */

import {
  BLOCK_COLS,
  BLOCK_ROWS,
  type Camera,
  type ExpandedContent,
  type GridRect,
  type Instance,
  type Lattice,
  type PixelRect,
  type PosterWall,
  type PosterWallHandlers,
  type Tile,
  type WallVisualOptions,
} from '../types.ts';
import { createRectSpring, type RectSpring } from './spring.ts';
import {
  applyCardBox,
  applyRect,
  applyTile,
  buildExpandedContent,
  clearPosterInstance,
  createPosterElement,
  entranceDelaySeconds,
  removeExpandedContent,
  resetPosterElement,
  type PosterElement,
} from './poster.ts';

const OVERSCAN_PX = 500;
const RECULL_MARGIN_PX = 180;
const CULL_LIMIT = 250;
const MAX_FREE = 64;
const MAX_FRAME_SECONDS = 0.064;
/** A gap longer than this means the rAF loop was idle; integrate one nominal frame instead of a big jump. */
const IDLE_GAP_SECONDS = 0.25;
/**
 * Cards a steady-state re-cull may (re)bind per frame. A pan crosses the re-cull margin every ~320 px
 * and would otherwise swap 20–40 cards (DOM, image, compositor layer) in one frame, which is the hitch
 * felt while dragging. New cards start 500 px off screen (nearest first), so spreading them out is
 * invisible, and cards that left the culled area are re-pointed at new instances in place instead of
 * being removed and re-inserted.
 */
const MOUNT_BUDGET_PER_FRAME = 8;

type Entry = {
  el: PosterElement;
  instance: Instance;
  spring: RectSpring | null;
  tileIndex: number;
  /** Layout rect in world px; equals the written rect once no spring is active. */
  target: PixelRect;
  /** Cull generation that last saw this entry; entries left behind are recycled. */
  stamp: number;
};

function gridEquals(a: GridRect, b: GridRect): boolean {
  return a.col === b.col && a.row === b.row && a.w === b.w && a.h === b.h;
}

function pixelEquals(a: PixelRect, b: PixelRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function intersects(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function createPosterWall(world: HTMLElement, handlers: PosterWallHandlers): PosterWall {
  let lattice: Lattice | null = null;
  let tiles: Tile[] = [];
  let currentTile: number | null = null;
  let expanded: Instance | null = null;
  let focused: Instance | null = null;
  /** `setFocus` asked to move DOM focus onto a card that was not mounted yet. */
  let focusPending = false;
  let reducedMotion = false;

  const pool = new Map<string, Entry>();
  const free: PosterElement[] = [];
  /** Instances from the latest cull still waiting for a card, nearest to the viewport first. */
  const pendingMounts: Instance[] = [];
  /** Mounted cards that left the culled area; reused for `pendingMounts` before any new card is made. */
  const staleEntries: Entry[] = [];
  let stamp = 0;
  let needsCull = true;
  /** Set by `setLattice`: every mounted card must re-read tile + rect and snap at the next cull. */
  let layoutDirty = true;
  let culledOnce = false;
  const cullBounds: PixelRect = { x: 0, y: 0, w: 0, h: 0 };
  let lastNow: number | null = null;
  let entrance: 'idle' | 'pending' | 'played' = 'idle';
  /** `onExpandSettled` still owed for the current expansion. */
  let settlePending = false;
  /** Previously expanded card that keeps its content until its spring settles. */
  let collapsing: Entry | null = null;
  let hoverId: string | null = null;
  let disposed = false;
  const abort = new AbortController();
  const signal = abort.signal;

  const gap = (): number => (lattice ? lattice.metrics.gap : 0);

  function entryFromTarget(target: EventTarget | null): Entry | null {
    const card = elementFromTarget(target)?.closest<HTMLElement>('.poster');
    if (!card) return null;
    const id = card.dataset.instance;
    return id === undefined ? null : (pool.get(id) ?? null);
  }

  function sameQueueId(previousTiles: Tile[], previousIndex: number, nextIndex: number): boolean {
    const before = previousTiles[previousIndex];
    const after = tiles[nextIndex];
    return before !== undefined && after !== undefined && before.queueId === after.queueId;
  }

  function setFocusAttrs(el: PosterElement): void {
    el.root.dataset.focused = 'true';
    el.root.tabIndex = 0;
  }

  function clearFocusAttrs(el: PosterElement): void {
    delete el.root.dataset.focused;
    el.root.tabIndex = -1;
  }

  function clearAllFocusAttrs(): void {
    for (const entry of pool.values()) clearFocusAttrs(entry.el);
  }

  /** Keep the expanded card last in `.world`. Moving a node drops DOM focus silently, so restore it. */
  function ensureOnTop(entry: Entry): void {
    const root = entry.el.root;
    if (world.lastElementChild === root) return;
    const active = document.activeElement;
    const refocus = active instanceof HTMLElement && root.contains(active) ? active : null;
    world.appendChild(root);
    refocus?.focus({ preventScroll: true });
  }

  /** New cards go beneath the expanded card so it never has to be re-appended (see `ensureOnTop`). */
  function insertCard(root: HTMLElement, instance: Instance): void {
    const anchor = expanded && expanded.id !== instance.id ? pool.get(expanded.id)?.el.root : undefined;
    if (anchor && anchor.parentElement === world) world.insertBefore(root, anchor);
    else world.appendChild(root);
  }

  function finishCollapse(): void {
    if (!collapsing) return;
    const entry = collapsing;
    collapsing = null;
    removeExpandedContent(entry.el);
    if (expanded) return;
    clearFocusAttrs(entry.el);
    if (focused?.id === entry.instance.id) {
      focused = null;
      focusPending = false;
      handlers.onFocusChange(null);
    }
  }

  function checkSettled(): void {
    if (!settlePending || !expanded) return;
    const entry = pool.get(expanded.id);
    if (!entry || entry.spring || layoutDirty) return;
    settlePending = false;
    entry.el.root.dataset.settled = 'true';
    const instance = expanded;
    // Deferred so main's own `setExpanded` call stack has unwound before it mounts lyrics.
    queueMicrotask(() => {
      if (!disposed && expanded && expanded.id === instance.id) handlers.onExpandSettled(instance);
    });
  }

  function moveEntry(entry: Entry, target: PixelRect, animate: boolean): void {
    const changed = !pixelEquals(entry.target, target);
    entry.target = target;
    if (!animate) {
      entry.spring = null;
      applyRect(entry.el, target, gap());
      return;
    }
    if (!changed) return;
    if (!entry.spring) entry.spring = createRectSpring({ ...entry.el.rect });
    entry.spring.setTarget(target);
  }

  function retargetBlock(lat: Lattice, bc: number, br: number, animate: boolean): void {
    for (const instance of lat.blockInstances(bc, br, expanded)) {
      const entry = pool.get(instance.id);
      if (!entry) continue;
      entry.instance = instance;
      const target = lat.toPixels(instance.rect);
      applyCardBox(entry.el, target);
      moveEntry(entry, target, animate);
    }
  }

  /** Points a card element (fresh, pooled or just unbound) at `instance` and registers it in the pool. */
  function bindEntry(lat: Lattice, el: PosterElement, instance: Instance, visible: PixelRect): Entry {
    const target = lat.toPixels(instance.rect);
    const entry: Entry = { el, instance, spring: null, tileIndex: instance.tileIndex, target, stamp };
    const tile = tiles[instance.tileIndex];
    // Commit the new box and cover together; do not request a resized variant of the old image.
    applyCardBox(el, target, false);
    applyTile(el, tile, instance.tileIndex === currentTile);
    applyRect(el, target, lat.metrics.gap);
    el.root.dataset.instance = instance.id;
    // Only a card that appears inside the viewport needs the fade; overscan mounts are never seen
    // popping in, and skipping the animation there avoids a class + animationend cycle per card.
    if (culledOnce && entrance !== 'pending' && !reducedMotion && intersects(target, visible)) {
      el.root.classList.add('poster--fade');
    }
    if (expanded && expanded.id === instance.id) {
      el.root.dataset.expanded = 'true';
      buildExpandedContent(el, tile);
    }
    if (focused !== null && focused.id === instance.id) setFocusAttrs(el);
    pool.set(instance.id, entry);
    return entry;
  }

  /** Once the card is in the DOM, deliver the DOM focus `setFocus` asked for before it was mounted. */
  function settleFocus(entry: Entry): void {
    if (!focusPending || focused === null || focused.id !== entry.instance.id) return;
    focusPending = false;
    entry.el.root.focus({ preventScroll: true });
  }

  function mountEntry(lat: Lattice, instance: Instance, visible: PixelRect): Entry {
    const el = free.pop() ?? createPosterElement();
    const entry = bindEntry(lat, el, instance, visible);
    insertCard(el.root, instance);
    settleFocus(entry);
    return entry;
  }

  /** Forget the instance a card shows; `park` also drops its cover because it is going to the free list. */
  function unbindEntry(entry: Entry, park: boolean): void {
    pool.delete(entry.instance.id);
    if (collapsing === entry) collapsing = null;
    if (hoverId === entry.instance.id) hoverId = null;
    const root = entry.el.root;
    const active = document.activeElement;
    // Taking the focused node away would drop DOM focus to <body>; hand it to the field instead.
    if (active && root.contains(active)) world.parentElement?.focus({ preventScroll: true });
    if (park) resetPosterElement(entry.el);
    else clearPosterInstance(entry.el);
    entry.spring = null;
  }

  /** Re-point a card that left the culled area at a new instance without touching the DOM tree. */
  function rebindEntry(lat: Lattice, entry: Entry, instance: Instance, visible: PixelRect): Entry {
    unbindEntry(entry, false);
    const next = bindEntry(lat, entry.el, instance, visible);
    settleFocus(next);
    return next;
  }

  function refreshEntry(lat: Lattice, entry: Entry, instance: Instance, snapAll: boolean): void {
    const previousRect = entry.instance.rect;
    entry.instance = instance;
    if (!snapAll && entry.tileIndex === instance.tileIndex && gridEquals(previousRect, instance.rect)) return;
    const target = lat.toPixels(instance.rect);
    applyCardBox(entry.el, target);
    if (snapAll || entry.tileIndex !== instance.tileIndex) {
      entry.tileIndex = instance.tileIndex;
      applyTile(entry.el, tiles[instance.tileIndex], instance.tileIndex === currentTile);
    }
    if (snapAll || !gridEquals(previousRect, instance.rect)) {
      moveEntry(entry, target, !snapAll && !reducedMotion);
    }
  }

  function recycleEntry(entry: Entry): void {
    unbindEntry(entry, true);
    entry.el.root.remove();
    if (free.length < MAX_FREE) free.push(entry.el);
  }

  /** Keep each mounted card on the same song if that song still has a slot in this block. */
  function rematchPoolByTile(lat: Lattice): void {
    if (pool.size === 0) return;
    const entries = [...pool.values()];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const entry of entries) {
      const rect = entry.target;
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    }
    const bounds: PixelRect = {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    };
    const available = lat.cull(bounds, OVERSCAN_PX, null, CULL_LIMIT);
    const taken = new Uint8Array(available.length);
    pool.clear();
    const leftover: Entry[] = [];
    const maxTravel = lat.unit * lat.unit * (BLOCK_COLS * BLOCK_COLS + BLOCK_ROWS * BLOCK_ROWS);
    const distanceTo = (instance: Instance, cx: number, cy: number): number => {
      const centre = lat.centerOf(instance.rect);
      const dx = centre.x - cx;
      const dy = centre.y - cy;
      return dx * dx + dy * dy;
    };
    const claim = (cx: number, cy: number, allow: (instance: Instance) => boolean): Instance | undefined => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < available.length; i++) {
        if (taken[i] === 1) continue;
        const instance = available[i];
        if (!instance || !allow(instance)) continue;
        const distance = distanceTo(instance, cx, cy);
        if (distance < bestD) {
          bestD = distance;
          best = i;
        }
      }
      if (best < 0) return undefined;
      taken[best] = 1;
      return available[best];
    };
    entries.sort((a, b) => {
      const aCurrent = currentTile !== null && a.tileIndex === currentTile ? 0 : 1;
      const bCurrent = currentTile !== null && b.tileIndex === currentTile ? 0 : 1;
      return aCurrent - bCurrent;
    });
    for (const entry of entries) {
      const cx = entry.target.x + entry.target.w / 2;
      const cy = entry.target.y + entry.target.h / 2;
      const instance =
        claim(cx, cy, (next) => next.bc === entry.instance.bc && next.br === entry.instance.br && next.tileIndex === entry.tileIndex)
        ?? claim(cx, cy, (next) => next.tileIndex === entry.tileIndex && distanceTo(next, cx, cy) <= maxTravel)
        ?? claim(cx, cy, (next) => next.bc === entry.instance.bc && next.br === entry.instance.br);
      if (!instance) {
        leftover.push(entry);
        continue;
      }
      if (instance.tileIndex !== entry.tileIndex) {
        entry.tileIndex = instance.tileIndex;
        applyTile(entry.el, tiles[entry.tileIndex], entry.tileIndex === currentTile);
      }
      entry.instance = instance;
      entry.el.root.dataset.instance = instance.id;
      if (focused === null || focused.id !== instance.id) clearFocusAttrs(entry.el);
      const target = lat.toPixels(instance.rect);
      applyCardBox(entry.el, target);
      moveEntry(entry, target, !reducedMotion);
      pool.set(instance.id, entry);
    }
    for (const entry of leftover) recycleEntry(entry);
  }

  function leavesCulledArea(bounds: PixelRect): boolean {
    const margin = OVERSCAN_PX - RECULL_MARGIN_PX;
    return (
      bounds.x < cullBounds.x - margin ||
      bounds.y < cullBounds.y - margin ||
      bounds.x + bounds.w > cullBounds.x + cullBounds.w + margin ||
      bounds.y + bounds.h > cullBounds.y + cullBounds.h + margin
    );
  }

  function recull(lat: Lattice, bounds: PixelRect): void {
    // Reserve one slot for the expanded card, which remains mounted even far outside the viewport.
    const culled = lat.cull(bounds, OVERSCAN_PX, expanded, expanded ? CULL_LIMIT - 1 : CULL_LIMIT);
    stamp += 1;
    const snapAll = layoutDirty;
    layoutDirty = false;
    // The first cull, a layout change and the entrance wave need every card in place this frame;
    // steady-state re-culls while panning hand the work to `flushMounts` a few cards per frame.
    const defer = culledOnce && !snapAll && entrance !== 'pending';
    pendingMounts.length = 0;
    staleEntries.length = 0;

    // Find reusable nodes first so even a whole-page replacement never grows beyond the DOM cap.
    const wanted = new Set(culled.map(instance => instance.id));
    for (const entry of pool.values()) {
      if (!wanted.has(entry.instance.id) && entry.instance.id !== expanded?.id) staleEntries.push(entry);
    }
    for (const instance of culled) {
      const entry = pool.get(instance.id);
      if (entry) {
        entry.stamp = stamp;
        refreshEntry(lat, entry, instance, snapAll);
      } else if (defer && !(expanded && expanded.id === instance.id)) {
        pendingMounts.push(instance);
      } else {
        const stale = staleEntries.pop();
        if (stale) rebindEntry(lat, stale, instance, bounds);
        else mountEntry(lat, instance, bounds);
      }
    }

    // The expanded card stays mounted even off-screen; it is the only exception to the cull.
    if (expanded) {
      const entry = pool.get(expanded.id);
      if (entry && entry.stamp !== stamp) {
        entry.stamp = stamp;
        refreshEntry(lat, entry, expanded, snapAll);
      }
    }

    if (!defer) while (staleEntries.length) recycleEntry(staleEntries.pop()!);
    // Stable partition: visible work first, preserve nearest-first order within each group.
    pendingMounts.sort((a, b) => Number(intersects(lat.toPixels(b.rect), bounds)) - Number(intersects(lat.toPixels(a.rect), bounds)));

    if (expanded) {
      const entry = pool.get(expanded.id);
      if (entry) ensureOnTop(entry);
    }

    cullBounds.x = bounds.x;
    cullBounds.y = bounds.y;
    cullBounds.w = bounds.w;
    cullBounds.h = bounds.h;
    culledOnce = true;
    needsCull = false;
  }

  /**
   * Works through the deferred cull a few cards per frame: fresh instances take over stale cards in
   * place, then any stale cards left over (the culled set shrank) go back to the free list. `render`
   * keeps the frame loop alive until both queues are empty.
   */
  function flushMounts(lat: Lattice, bounds: PixelRect): void {
    let budget = MOUNT_BUDGET_PER_FRAME;
    const deadline = performance.now() + 3;
    while (pendingMounts.length > 0) {
      // A fast fling or camera jump can overtake the overscan. Fill visible holes in this frame;
      // only offscreen preparation is allowed to wait for the budget of the next frame.
      const visible = intersects(lat.toPixels(pendingMounts[0]!.rect), bounds);
      if (!visible && (budget <= 0 || performance.now() >= deadline)) break;
      const instance = pendingMounts.shift()!;
      if (pool.has(instance.id)) continue;
      const stale = staleEntries.pop();
      if (stale) rebindEntry(lat, stale, instance, bounds);
      else mountEntry(lat, instance, bounds);
      budget -= 1;
    }
    while (budget > 0 && performance.now() < deadline && pendingMounts.length === 0 && staleEntries.length > 0) {
      recycleEntry(staleEntries.pop()!);
      budget -= 1;
    }
  }

  function applyEntrance(lat: Lattice, bounds: PixelRect): void {
    entrance = 'played';
    if (reducedMotion) return;
    const leftCol = Math.floor(bounds.x / lat.unit);
    const topRow = Math.floor(bounds.y / lat.unit);
    for (const entry of pool.values()) {
      // The already-expanded card is on screen at ready; only the other tiles ride the wave
      // (SPEC §2.1). Putting `poster--enter` on it would replay overlay fade-in when the class
      // is removed and make the chrome vanish for a frame.
      if (expanded && entry.instance.id === expanded.id) continue;
      const root = entry.el.root;
      root.style.setProperty('--enter-delay', `${entranceDelaySeconds(entry.instance.rect, leftCol, topRow)}s`);
      root.classList.remove('poster--fade');
      root.classList.add('poster--enter');
    }
  }

  function snapAll(): void {
    const g = gap();
    for (const entry of pool.values()) {
      if (!entry.spring) continue;
      entry.spring = null;
      applyRect(entry.el, entry.target, g);
    }
    finishCollapse();
    checkSettled();
  }

  function applyFocus(instance: Instance | null, moveDomFocus: boolean): void {
    if (focused && (!instance || focused.id !== instance.id)) {
      const previous = pool.get(focused.id);
      if (previous) clearFocusAttrs(previous.el);
    }
    const changed = focused?.id !== instance?.id;
    focused = instance;
    focusPending = false;
    if (!instance) {
      clearAllFocusAttrs();
      if (changed) handlers.onFocusChange(null);
      return;
    }
    for (const entry of pool.values()) {
      if (entry.instance.id !== instance.id) clearFocusAttrs(entry.el);
    }
    const entry = pool.get(instance.id);
    if (!entry) {
      focusPending = moveDomFocus;
      return;
    }
    setFocusAttrs(entry.el);
    // Focus already inside the card (e.g. on the seek slider) is left where it is.
    const active = document.activeElement;
    if (moveDomFocus && !(active && entry.el.root.contains(active))) entry.el.root.focus({ preventScroll: true });
  }

  world.addEventListener(
    'click',
    (event) => {
      const entry = entryFromTarget(event.target);
      if (!entry) return;
      if (expanded && entry.instance.id === expanded.id) {
        // The second click of a double-click must not immediately hide the controls just shown.
        if (event.detail > 1) return;
        const element = elementFromTarget(event.target);
        if (element?.closest('.poster__controls')) return;
        handlers.onExpandedTap(entry.instance);
        return;
      }
      handlers.onActivate(entry.instance);
    },
    { signal },
  );

  world.addEventListener(
    'mousedown',
    (event) => {
      // A press that turns into a drag must not focus the card it started on; real taps get DOM
      // focus through `setFocus` from main. Controls keep their native press behaviour.
      const element = elementFromTarget(event.target);
      if (element && !element.closest('.poster__controls, button, input, select, textarea, a[href]')) event.preventDefault();
    },
    { signal },
  );

  world.addEventListener(
    'pointerover',
    (event) => {
      const entry = entryFromTarget(event.target);
      if (!entry || hoverId === entry.instance.id) return;
      hoverId = entry.instance.id;
      if (currentTile !== null && entry.tileIndex === currentTile) handlers.onHoverCurrent(entry.instance);
    },
    { signal, passive: true },
  );

  world.addEventListener(
    'pointerout',
    (event) => {
      const card = elementFromTarget(event.target)?.closest<HTMLElement>('.poster');
      if (!card) return;
      const to = event.relatedTarget;
      if (to instanceof Node && card.contains(to)) return;
      if (hoverId === card.dataset.instance) hoverId = null;
    },
    { signal, passive: true },
  );

  world.addEventListener(
    'focusin',
    (event) => {
      const entry = entryFromTarget(event.target);
      if (!entry || (focused && focused.id === entry.instance.id)) return;
      applyFocus(entry.instance, false);
      handlers.onFocusChange(entry.instance);
    },
    { signal },
  );

  world.addEventListener(
    'animationend',
    (event) => {
      if (event.animationName !== 'poster-enter' && event.animationName !== 'poster-fade') return;
      elementFromTarget(event.target)?.closest('.poster')?.classList.remove('poster--enter', 'poster--fade');
    },
    { signal },
  );

  return {
    setLattice(nextLattice, nextTiles, options) {
      const previousTiles = tiles;
      const previousExpanded = expanded;
      const previousFocused = focused;
      const followTiles = options?.followTiles === true;
      lattice = nextLattice;
      tiles = nextTiles;
      layoutDirty = !followTiles;
      needsCull = true;
      hoverId = null;
      finishCollapse();
      if (followTiles) {
        if (previousExpanded) {
          const entry = pool.get(previousExpanded.id);
          if (entry) {
            delete entry.el.root.dataset.expanded;
            delete entry.el.root.dataset.settled;
            delete entry.el.root.dataset.lyrics;
            removeExpandedContent(entry.el);
          }
        }
        expanded = null;
        focused = null;
        focusPending = false;
        settlePending = false;
        clearAllFocusAttrs();
        rematchPoolByTile(nextLattice);
        return;
      }

      let nextExpanded: Instance | null = null;
      if (previousExpanded) {
        const base = nextLattice.fromId(previousExpanded.id, null);
        if (base && sameQueueId(previousTiles, previousExpanded.tileIndex, base.tileIndex)) {
          nextExpanded = nextLattice.fromId(previousExpanded.id, base) ?? base;
        }
      }
      let nextFocused: Instance | null = null;
      if (previousFocused) {
        const candidate = nextLattice.fromId(previousFocused.id, nextExpanded);
        if (candidate && sameQueueId(previousTiles, previousFocused.tileIndex, candidate.tileIndex)) {
          nextFocused = candidate;
        }
      }

      if (previousExpanded && !nextExpanded) {
        const entry = pool.get(previousExpanded.id);
        if (entry) {
          delete entry.el.root.dataset.expanded;
          delete entry.el.root.dataset.settled;
          delete entry.el.root.dataset.lyrics;
          removeExpandedContent(entry.el);
        }
        settlePending = false;
      }
      expanded = nextExpanded;

      if (previousFocused && !nextFocused) {
        const entry = pool.get(previousFocused.id);
        if (entry) clearFocusAttrs(entry.el);
        focused = null;
        focusPending = false;
        handlers.onFocusChange(null);
      } else {
        focused = nextFocused;
      }
    },

    setCurrent(tileIndex) {
      if (tileIndex === currentTile) return;
      const previous = currentTile;
      currentTile = tileIndex;
      for (const entry of pool.values()) {
        if (entry.tileIndex === previous || entry.tileIndex === tileIndex) {
          applyTile(entry.el, tiles[entry.tileIndex], entry.tileIndex === tileIndex);
        }
      }
    },

    setExpanded(instance) {
      if (instance && expanded && instance.id === expanded.id) return;
      if (!instance && !expanded) return;
      const previous = expanded;
      // Callers may pass an instance carrying its un-expanded rect (e.g. from `nearestInstance`);
      // store the reflowed 6×6 version so off-screen refreshes never shrink the card.
      expanded = instance && lattice ? lattice.instanceAt(instance.bc, instance.br, instance.slot, instance) : instance;
      settlePending = instance !== null;
      needsCull = true;
      const animate = !reducedMotion && !layoutDirty;
      finishCollapse();

      if (previous) {
        const entry = pool.get(previous.id);
        if (entry) {
          delete entry.el.root.dataset.expanded;
          delete entry.el.root.dataset.settled;
          delete entry.el.root.dataset.lyrics;
          if (animate) collapsing = entry;
          else removeExpandedContent(entry.el);
        }
      }

      // While the layout is dirty the next cull re-reads and snaps every rect anyway.
      if (lattice && !layoutDirty) {
        if (previous) retargetBlock(lattice, previous.bc, previous.br, animate);
        const sameBlock = previous !== null && instance !== null && previous.bc === instance.bc && previous.br === instance.br;
        if (instance && !sameBlock) retargetBlock(lattice, instance.bc, instance.br, animate);
      }

      if (instance) {
        const entry = pool.get(instance.id);
        if (entry) {
          entry.el.root.dataset.expanded = 'true';
          delete entry.el.root.dataset.settled;
          buildExpandedContent(entry.el, tiles[entry.tileIndex]);
          if (!animate) entry.el.root.dataset.settled = 'true';
          ensureOnTop(entry);
        }
      }

      if (collapsing && !collapsing.spring) finishCollapse();
      checkSettled();
    },

    get expanded() {
      return expanded;
    },

    setFocus(instance, options) {
      applyFocus(instance, options?.scrollIntoView !== false);
    },

    get focused() {
      return focused;
    },

    setVisualOptions(options) {
      world.dataset.lightsOut = String(options.lightsOut);
      world.dataset.tint = String(options.tint);
      world.dataset.reducedMotion = String(options.reducedMotion);
      world.style.setProperty('--tint-color', options.tintColor);
      world.style.setProperty('--tint-alpha', String(Math.min(0.85, Math.max(0, options.tintIntensity))));
      const wasReduced = reducedMotion;
      reducedMotion = options.reducedMotion;
      if (reducedMotion && !wasReduced) snapAll();
    },

    render(camera, nowMs) {
      if (disposed || !lattice) return false;
      let dt = 1 / 60;
      if (lastNow !== null) {
        const elapsed = (nowMs - lastNow) / 1000;
        if (elapsed <= IDLE_GAP_SECONDS) dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, elapsed));
      }
      lastNow = nowMs;

      const bounds = camera.bounds();
      if (needsCull || leavesCulledArea(bounds)) recull(lattice, bounds);
      if (pendingMounts.length > 0 || staleEntries.length > 0) flushMounts(lattice, bounds);
      if (entrance === 'pending') applyEntrance(lattice, bounds);

      let moving = pendingMounts.length > 0 || staleEntries.length > 0;
      const g = lattice.metrics.gap;
      for (const entry of pool.values()) {
        const spring = entry.spring;
        if (!spring) continue;
        if (spring.step(dt)) {
          applyRect(entry.el, spring.current, g);
          moving = true;
        } else {
          entry.spring = null;
          applyRect(entry.el, entry.target, g);
        }
      }

      if (collapsing && !collapsing.spring) finishCollapse();
      checkSettled();
      return moving;
    },

    playEntrance() {
      if (entrance === 'idle' && !reducedMotion) entrance = 'pending';
    },

    expandedVisible(camera) {
      if (!expanded) return false;
      const entry = pool.get(expanded.id);
      if (!entry) return false;
      return intersects(entry.spring ? entry.spring.current : entry.target, camera.bounds());
    },

    expandedContent(): ExpandedContent | null {
      if (!expanded) return null;
      return pool.get(expanded.id)?.el.expanded ?? null;
    },

    instanceFromTarget(target) {
      return entryFromTarget(target)?.instance ?? null;
    },

    clear() {
      if (document.activeElement && world.contains(document.activeElement)) world.parentElement?.focus({ preventScroll: true });
      for (const entry of pool.values()) entry.el.root.remove();
      pool.clear(); free.length = 0; pendingMounts.length = 0; staleEntries.length = 0;
      lattice = null; tiles = []; expanded = null; focused = null; currentTile = null;
      collapsing = null; hoverId = null; focusPending = false; settlePending = false;
      needsCull = true; layoutDirty = true; culledOnce = false; lastNow = null; entrance = 'idle';
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      for (const entry of pool.values()) entry.el.root.remove();
      pool.clear();
      pendingMounts.length = 0;
      staleEntries.length = 0;
      free.length = 0;
      lattice = null;
      tiles = [];
      expanded = null;
      focused = null;
      collapsing = null;
    },
  };
}
