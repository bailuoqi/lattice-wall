import type { GridRect } from '../types.ts';
import type { LatticeSlotPlan } from './lattice.ts';

const COVER_GAP = 4;
const REPAIR_PASSES = 4;

/** Distance between card edges, including the seam where the wall repeats. */
export function slotGap2(a: GridRect, b: GridRect, cols: number, rows: number): number {
  const dx = Math.abs(a.col + a.w / 2 - b.col - b.w / 2);
  const dy = Math.abs(a.row + a.h / 2 - b.row - b.h / 2);
  const gapX = Math.max(0, Math.min(dx, cols - dx) - (a.w + b.w) / 2);
  const gapY = Math.max(0, Math.min(dy, rows - dy) - (a.h + b.h) / 2);
  return gapX * gapX + gapY * gapY;
}

/**
 * Improve crowded pairs without adding/removing copies or moving a pinned card. Exact tile copies
 * need much more separation than different songs sharing artwork. All scratch data is page-local;
 * no pair table is retained by the lattice or consulted while dragging/playing.
 */
export function repairSlotSpacing(assigned: number[], keys: readonly string[], plan: LatticeSlotPlan, lockedSlot = -1): void {
  const count = assigned.length;
  const duplicateGap = Math.max(COVER_GAP, Math.min(plan.gridCols, plan.gridRows) * .45);
  const coverPenalty = new Float32Array(count * count);
  const duplicatePenalty = new Float32Array(count * count);
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const gap = Math.sqrt(slotGap2(plan.rects[a]!, plan.rects[b]!, plan.gridCols, plan.gridRows));
      const cover = Math.max(0, 1 - gap / COVER_GAP) ** 2;
      const duplicate = 16 * Math.max(0, 1 - gap / duplicateGap) ** 2;
      coverPenalty[a * count + b] = coverPenalty[b * count + a] = cover;
      duplicatePenalty[a * count + b] = duplicatePenalty[b * count + a] = duplicate;
    }
  }
  const groups = new Map<string, Set<number>>();
  for (let slot = 0; slot < count; slot++) {
    const key = keys[assigned[slot]!]!;
    let group = groups.get(key);
    if (!group) { group = new Set(); groups.set(key, group); }
    group.add(slot);
  }

  function cost(slot: number, tile: number, except = -1): number {
    const group = groups.get(keys[tile]!);
    if (!group) return 0;
    let sum = 0;
    for (const other of group) {
      if (other === slot || other === except) continue;
      const offset = slot * count + other;
      if (assigned[other] === tile) sum += duplicatePenalty[offset]!;
      // With only one artwork every cover pair is unavoidable; optimize exact copies only.
      else if (groups.size > 1) sum += coverPenalty[offset]!;
    }
    return sum;
  }

  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    let moved = false;
    for (let slot = 0; slot < count; slot++) {
      if (slot === lockedSlot || cost(slot, assigned[slot]!) === 0) continue;
      const tile = assigned[slot]!;
      let best = -1;
      let bestGain = 1e-6;
      for (let candidate = 0; candidate < count; candidate++) {
        const otherTile = assigned[candidate]!;
        if (candidate === slot || candidate === lockedSlot || otherTile === tile) continue;
        const before = cost(slot, tile, candidate) + cost(candidate, otherTile, slot);
        const after = cost(slot, otherTile, candidate) + cost(candidate, tile, slot);
        const gain = before - after;
        if (gain > bestGain) { bestGain = gain; best = candidate; }
      }
      if (best < 0) continue;
      const otherTile = assigned[best]!;
      const group = groups.get(keys[tile]!)!;
      const otherGroup = groups.get(keys[otherTile]!)!;
      if (group !== otherGroup) {
        group.delete(slot); group.add(best);
        otherGroup.delete(best); otherGroup.add(slot);
      }
      assigned[slot] = otherTile;
      assigned[best] = tile;
      moved = true;
    }
    if (!moved) break;
  }
}
