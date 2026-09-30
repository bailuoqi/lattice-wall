/**
 * Identity- and cover-aware slot assignment shared by the library and album walls. Repeated tiles
 * take priority over shared artwork when spreading cards across the periodic cell. Geometry stays in
 * `lattice.ts`; this file only decides `slot → tileIndex`.
 */

import { SLOTS_PER_BLOCK, type Instance, type Lattice, type Metrics, type Point, type Tile } from '../types.ts';
import { createLattice, planLatticeSlots, type LatticeSlotPlan } from './lattice.ts';
import { repairSlotSpacing, slotGap2 } from './slotSpacing.ts';

/** Pin one tile to a slot (used after collapsing the playing track onto a nearby square). */
export type SlotPin = { tileIndex: number; slot: number };
export type SpreadPin = { tileIndex: number; near: Point };

const LOCAL_COVER_VARIANT = /^echo-cover:\/\/(?:thumb|album|large)\//u;

export function tileCoverKey(tile: Pick<Tile, 'album' | 'artist' | 'coverUrl' | 'trackId' | 'albumId'>): string {
  if (tile.coverUrl) return tile.coverUrl.replace(LOCAL_COVER_VARIANT, 'echo-cover://cover/');
  if (tile.albumId) return `album-id:${tile.albumId}`;
  const album = tile.album.trim();
  if (album !== '') return `album:${tile.artist.trim()}\0${album}`;
  return `track:${tile.trackId}`;
}

export function torusDistance2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cell: { w: number; h: number },
): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > cell.w * 0.5) dx = cell.w - dx;
  if (dy > cell.h * 0.5) dy = cell.h - dy;
  return dx * dx + dy * dy;
}

function extraTileIndexes(coverKeys: readonly string[], extra: number, pinnedTile = -1): number[] {
  if (extra <= 0) return [];
  const freq = new Map<string, number>();
  for (const key of coverKeys) freq.set(key, (freq.get(key) ?? 0) + 1);
  // Keep the pinned card's square as its only copy when other tiles can fill the gaps.
  const order = coverKeys.map((_, index) => index).filter(index => index !== pinnedTile || coverKeys.length === 1);
  order.sort((a, b) => {
    const freqA = freq.get(coverKeys[a] ?? '') ?? 0;
    const freqB = freq.get(coverKeys[b] ?? '') ?? 0;
    return freqA - freqB || a - b;
  });
  return Array.from({ length: extra }, (_, index) => order[index % order.length]!);
}

function groupsLargestFirst(copies: readonly number[], coverKeys: readonly string[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const tileIndex of copies) {
    const key = coverKeys[tileIndex] ?? `tile:${tileIndex}`;
    const group = groups.get(key);
    if (group) group.push(tileIndex);
    else groups.set(key, [tileIndex]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || (a[0] ?? 0) - (b[0] ?? 0));
}

function wrapCoord(value: number, size: number): number {
  if (!(size > 0)) return 0;
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function pullMinDistFrom(slot: number, plan: LatticeSlotPlan, used: Uint8Array, minDist: Float64Array): void {
  const placed = plan.rects[slot];
  if (placed === undefined) return;
  for (let other = 0; other < used.length; other++) {
    if (used[other] === 1) continue;
    const rect = plan.rects[other];
    if (rect === undefined) continue;
    const distance = slotGap2(placed, rect, plan.gridCols, plan.gridRows);
    const current = minDist[other];
    if (current !== undefined && distance < current) minDist[other] = distance;
  }
}

/** Prefer a nearby 4×4, otherwise the nearest 2×2, so a collapsed playing track lands on a square. */
export function pickSquareSlot(plan: LatticeSlotPlan, near: Point): number {
  const wrapped = {
    x: wrapCoord(near.x, plan.cellPixelSize.w),
    y: wrapCoord(near.y, plan.cellPixelSize.h),
  };
  let bestSlot = -1;
  let bestScore = Infinity;
  for (let slot = 0; slot < plan.rects.length; slot++) {
    const rect = plan.rects[slot];
    const center = plan.centers[slot];
    if (rect === undefined || center === undefined || rect.w !== rect.h) continue;
    const score = torusDistance2(center.x, center.y, wrapped.x, wrapped.y, plan.cellPixelSize) / (rect.w * rect.h);
    if (score < bestScore || (score === bestScore && (bestSlot < 0 || slot < bestSlot))) {
      bestScore = score;
      bestSlot = slot;
    }
  }
  if (bestSlot < 0) throw new Error('pickSquareSlot: no square slots in the lattice plan');
  return bestSlot;
}

/** Place every tile, spreading its extra copies before optimizing shared-artwork spacing. */
export function spreadSlotToTile(coverKeys: readonly string[], plan: LatticeSlotPlan, pin?: SlotPin): number[] {
  const tileCount = coverKeys.length;
  const slotCount = plan.centers.length;
  if (tileCount < 1 || slotCount < tileCount) {
    throw new RangeError(`need at least as many slots as tiles, got tiles=${tileCount} slots=${slotCount}`);
  }
  let pinSlot = -1;
  let pinTile = -1;
  if (pin && pin.slot >= 0 && pin.slot < slotCount && pin.tileIndex >= 0 && pin.tileIndex < tileCount) {
    pinSlot = pin.slot;
    pinTile = pin.tileIndex;
  }

  const copies = coverKeys.map((_, index) => index);
  copies.push(...extraTileIndexes(coverKeys, slotCount - tileCount, pinTile));
  if (pinTile >= 0) {
    const removeAt = copies.indexOf(pinTile);
    if (removeAt >= 0) copies.splice(removeAt, 1);
  }

  const assigned = new Array<number>(slotCount).fill(-1);
  const used = new Uint8Array(slotCount);
  const minDist = new Float64Array(slotCount);
  const tileSlots: number[][] = Array.from({ length: tileCount }, () => []);
  if (pinSlot >= 0 && pinTile >= 0) {
    assigned[pinSlot] = pinTile;
    used[pinSlot] = 1;
    tileSlots[pinTile]!.push(pinSlot);
  }

  const pinKey = pinTile >= 0 ? (coverKeys[pinTile] ?? '') : '';
  for (const group of groupsLargestFirst(copies, coverKeys)) {
    minDist.fill(Number.POSITIVE_INFINITY);
    if (pinSlot >= 0 && pinKey !== '' && (coverKeys[group[0] ?? -1] ?? '') === pinKey) {
      pullMinDistFrom(pinSlot, plan, used, minDist);
    }
    for (const tileIndex of group) {
      let bestSlot = -1;
      let best = -1;
      let bestTileDistance = -1;
      for (let slot = 0; slot < slotCount; slot++) {
        if (used[slot] === 1) continue;
        const distance = minDist[slot] ?? 0;
        let tileDistance = Infinity;
        for (const prior of tileSlots[tileIndex]!) {
          tileDistance = Math.min(tileDistance, slotGap2(plan.rects[slot]!, plan.rects[prior]!, plan.gridCols, plan.gridRows));
        }
        if (tileDistance > bestTileDistance || (tileDistance === bestTileDistance && distance > best)) {
          bestTileDistance = tileDistance;
          best = distance;
          bestSlot = slot;
        }
      }
      if (bestSlot < 0) throw new Error('spreadSlotToTile ran out of slots');
      assigned[bestSlot] = tileIndex;
      used[bestSlot] = 1;
      tileSlots[tileIndex]!.push(bestSlot);
      pullMinDistFrom(bestSlot, plan, used, minDist);
    }
  }

  repairSlotSpacing(assigned, coverKeys, plan, pinSlot);
  return assigned;
}

export function createSpreadLattice(tiles: readonly Tile[], metrics: Metrics, pin?: SpreadPin): Lattice {
  const plan = planLatticeSlots(tiles.length, metrics);
  const keys = tiles.map(tileCoverKey);
  if (!pin || pin.tileIndex < 0 || pin.tileIndex >= tiles.length) {
    return createLattice(tiles.length, metrics, spreadSlotToTile(keys, plan));
  }
  const slot = pickSquareSlot(plan, pin.near);
  return createLattice(tiles.length, metrics, spreadSlotToTile(keys, plan, { tileIndex: pin.tileIndex, slot }));
}

/** Origin-cell `cellSlot → tileIndex` taken from an existing lattice. */
export function readSlotToTile(lattice: Lattice): number[] {
  const mapping = new Array<number>(lattice.blocksPerCell * SLOTS_PER_BLOCK).fill(0);
  for (let br = 0; br < lattice.cellRows; br++) {
    for (let bc = 0; bc < lattice.cellCols; bc++) {
      for (const instance of lattice.blockInstances(bc, br, null)) {
        mapping[instance.cellSlot] = instance.tileIndex;
      }
    }
  }
  return mapping;
}

/**
 * Keep the current spread. Only swap the playing tile with the nearest square in the same block
 * so collapse can land on a 4×4 / 2×2 without rebuilding the wall.
 */
export function reseatPlayingToSquare(lattice: Lattice, from: Instance, tileIndex: number): number[] {
  const mapping = readSlotToTile(lattice);
  if (tileIndex < 0 || tileIndex >= lattice.tileCount) return mapping;
  const block = lattice.blockInstances(from.bc, from.br, null);
  const near = lattice.centerOf(from.rect);
  let best = -1;
  let bestScore = Infinity;
  for (let index = 0; index < block.length; index++) {
    const instance = block[index];
    if (!instance || instance.rect.w !== instance.rect.h) continue;
    const center = lattice.centerOf(instance.rect);
    const dx = center.x - near.x;
    const dy = center.y - near.y;
    const score = (dx * dx + dy * dy) / (instance.rect.w * instance.rect.h);
    if (score < bestScore || (score === bestScore && (best < 0 || index < best))) {
      bestScore = score;
      best = index;
    }
  }
  const square = best >= 0 ? block[best] : undefined;
  const current = block.find((instance) => instance.slot === from.slot) ?? block.find((instance) => instance.tileIndex === tileIndex);
  if (!square || !current || square.cellSlot === current.cellSlot) return mapping;
  const displaced = mapping[square.cellSlot] ?? square.tileIndex;
  mapping[square.cellSlot] = tileIndex;
  mapping[current.cellSlot] = displaced;
  return mapping;
}
