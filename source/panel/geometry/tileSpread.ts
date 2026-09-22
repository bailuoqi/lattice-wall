/**
 * Cover-aware slot assignment for the library wall. Sequential `cellSlot % tileCount` packs an album's
 * tracks into a contiguous region; this module places copies of the same cover by farthest-point
 * sampling on the periodic cell, then swaps any remaining edge-adjacent pairs. Geometry stays in
 * `lattice.ts`; this file only decides `slot → tileIndex`.
 */

import { SLOTS_PER_BLOCK, type GridRect, type Instance, type Lattice, type Metrics, type Point, type Tile } from '../types.ts';
import { createLattice, planLatticeSlots, type LatticeSlotPlan } from './lattice.ts';

/** Pin one tile to a slot (used after collapsing the playing track onto a nearby square). */
export type SlotPin = { tileIndex: number; slot: number };
export type SpreadPin = { tileIndex: number; near: Point };

const LOCAL_COVER_VARIANT = /^echo-cover:\/\/(?:thumb|album|large)\//u;
const REPAIR_PASSES = 8;

export function tileCoverKey(tile: Pick<Tile, 'album' | 'artist' | 'coverUrl' | 'trackId'>): string {
  if (tile.coverUrl) return tile.coverUrl.replace(LOCAL_COVER_VARIANT, 'echo-cover://cover/');
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

function extraTileIndexes(coverKeys: readonly string[], extra: number): number[] {
  if (extra <= 0) return [];
  const freq = new Map<string, number>();
  for (const key of coverKeys) freq.set(key, (freq.get(key) ?? 0) + 1);
  const order = coverKeys.map((_, index) => index);
  order.sort((a, b) => {
    const freqA = freq.get(coverKeys[a] ?? '') ?? 0;
    const freqB = freq.get(coverKeys[b] ?? '') ?? 0;
    return freqA - freqB || a - b;
  });
  return order.slice(0, extra);
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

function shareEdge(a: GridRect, b: GridRect): boolean {
  const aRight = a.col + a.w;
  const aBottom = a.row + a.h;
  const bRight = b.col + b.w;
  const bBottom = b.row + b.h;
  const overlapX = Math.min(aRight, bRight) - Math.max(a.col, b.col);
  const overlapY = Math.min(aBottom, bBottom) - Math.max(a.row, b.row);
  if (overlapX > 0 && (aRight === b.col || bRight === a.col)) return true;
  if (overlapY > 0 && (aBottom === b.row || bBottom === a.row)) return true;
  return false;
}

function shareEdgeTorus(a: GridRect, b: GridRect, gridCols: number, gridRows: number): boolean {
  for (const ox of [-gridCols, 0, gridCols]) {
    for (const oy of [-gridRows, 0, gridRows]) {
      if (ox === 0 && oy === 0) {
        if (shareEdge(a, b)) return true;
        continue;
      }
      if (shareEdge(a, { col: b.col + ox, row: b.row + oy, w: b.w, h: b.h })) return true;
    }
  }
  return false;
}

function slotNeighbors(rects: readonly GridRect[], gridCols: number, gridRows: number): number[][] {
  const neighbors: number[][] = Array.from({ length: rects.length }, () => []);
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (b === undefined || !shareEdgeTorus(a, b, gridCols, gridRows)) continue;
      neighbors[i]?.push(j);
      neighbors[j]?.push(i);
    }
  }
  return neighbors;
}

function pairConflicts(
  assigned: readonly number[],
  keys: readonly string[],
  neighbors: readonly number[][],
  slotA: number,
  tileA: number,
  slotB: number,
  tileB: number,
): number {
  const keyA = keys[tileA];
  const keyB = keys[tileB];
  let count = 0;
  for (const next of neighbors[slotA] ?? []) {
    const tile = next === slotB ? tileB : assigned[next];
    if (tile !== undefined && keys[tile] === keyA) count += 1;
  }
  for (const next of neighbors[slotB] ?? []) {
    const tile = next === slotA ? tileA : assigned[next];
    if (tile !== undefined && keys[tile] === keyB) count += 1;
  }
  return count;
}

/** Swap different-cover slots when that removes more same-cover edges than it creates. */
function repairAdjacentPairs(
  assigned: number[],
  keys: readonly string[],
  neighbors: readonly number[][],
  lockedSlot = -1,
): void {
  const slotCount = assigned.length;
  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    let moved = false;
    for (let slot = 0; slot < slotCount; slot++) {
      if (slot === lockedSlot) continue;
      const tile = assigned[slot];
      if (tile === undefined) continue;
      for (const other of neighbors[slot] ?? []) {
        if (other <= slot || other === lockedSlot) continue;
        const otherTile = assigned[other];
        if (otherTile === undefined || keys[otherTile] !== keys[tile]) continue;
        let best = -1;
        let bestGain = 0;
        for (let candidate = 0; candidate < slotCount; candidate++) {
          if (candidate === slot || candidate === other || candidate === lockedSlot) continue;
          const candidateTile = assigned[candidate];
          if (candidateTile === undefined || keys[candidateTile] === keys[tile]) continue;
          const before = pairConflicts(assigned, keys, neighbors, slot, tile, candidate, candidateTile);
          const after = pairConflicts(assigned, keys, neighbors, slot, candidateTile, candidate, tile);
          const gain = before - after;
          if (gain > bestGain || (gain === bestGain && gain > 0 && (best < 0 || candidate < best))) {
            bestGain = gain;
            best = candidate;
          }
        }
        if (best < 0 || bestGain <= 0) continue;
        const swap = assigned[best];
        if (swap === undefined) continue;
        assigned[slot] = swap;
        assigned[best] = tile;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
}

/**
 * Assign every origin-cell slot a tile index. Each queue tile appears at least once; leftover
 * slots (the cell is a full rectangle of 12-slot blocks) become extra copies of the rarest covers.
 * Groups with the same cover key are placed by farthest-point sampling, then adjacent same-cover
 * pairs are swapped away when another cover can take the edge.
 */
function wrapCoord(value: number, size: number): number {
  if (!(size > 0)) return 0;
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function pullMinDistFrom(slot: number, plan: LatticeSlotPlan, used: Uint8Array, minDist: Float64Array): void {
  const placed = plan.centers[slot];
  if (placed === undefined) return;
  for (let other = 0; other < used.length; other++) {
    if (used[other] === 1) continue;
    const point = plan.centers[other];
    if (point === undefined) continue;
    const distance = torusDistance2(placed.x, placed.y, point.x, point.y, plan.cellPixelSize);
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
  copies.push(...extraTileIndexes(coverKeys, slotCount - tileCount));
  if (pinTile >= 0) {
    const removeAt = copies.indexOf(pinTile);
    if (removeAt >= 0) copies.splice(removeAt, 1);
  }

  const assigned = new Array<number>(slotCount).fill(-1);
  const used = new Uint8Array(slotCount);
  const minDist = new Float64Array(slotCount);
  if (pinSlot >= 0 && pinTile >= 0) {
    assigned[pinSlot] = pinTile;
    used[pinSlot] = 1;
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
      for (let slot = 0; slot < slotCount; slot++) {
        if (used[slot] === 1) continue;
        const distance = minDist[slot] ?? 0;
        if (distance > best || (distance === best && (bestSlot < 0 || slot < bestSlot))) {
          best = distance;
          bestSlot = slot;
        }
      }
      if (bestSlot < 0) throw new Error('spreadSlotToTile ran out of slots');
      assigned[bestSlot] = tileIndex;
      used[bestSlot] = 1;
      pullMinDistFrom(bestSlot, plan, used, minDist);
    }
  }

  repairAdjacentPairs(assigned, coverKeys, slotNeighbors(plan.rects, plan.gridCols, plan.gridRows), pinSlot);
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
