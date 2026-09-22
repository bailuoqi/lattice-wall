// Cover-aware slot assignment for the queue wall. Run with `node --test scripts/test-tile-spread.mjs`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLattice, planLatticeSlots } from '../source/panel/geometry/lattice.ts';
import {
  createSpreadLattice,
  pickSquareSlot,
  readSlotToTile,
  reseatPlayingToSquare,
  spreadSlotToTile,
  tileCoverKey,
  torusDistance2,
} from '../source/panel/geometry/tileSpread.ts';

const METRICS = { cell: 104, gap: 8 };

const tile = (index, overrides = {}) => ({
  index,
  queueId: `queue-${index}`,
  trackId: overrides.trackId ?? `track-${index}`,
  title: `Title ${index}`,
  artist: overrides.artist ?? 'Artist',
  album: overrides.album ?? 'Album',
  coverUrl: Object.prototype.hasOwnProperty.call(overrides, 'coverUrl')
    ? overrides.coverUrl
    : `echo-cover://thumb/album-${overrides.albumKey ?? 'a'}`,
  durationSeconds: 180,
});

const minSameCoverDistance = (mapping, keys, centers, cell) => {
  let min = Infinity;
  for (let i = 0; i < mapping.length; i++) {
    for (let j = i + 1; j < mapping.length; j++) {
      const a = mapping[i];
      const b = mapping[j];
      if (a === undefined || b === undefined || keys[a] !== keys[b]) continue;
      const pa = centers[i];
      const pb = centers[j];
      if (pa === undefined || pb === undefined) continue;
      const distance = torusDistance2(pa.x, pa.y, pb.x, pb.y, cell);
      if (distance < min) min = distance;
    }
  }
  return min;
};

const adjacentSameCoverCount = (lattice, keys) => {
  let count = 0;
  for (let br = 0; br < lattice.cellRows; br++) {
    for (let bc = 0; bc < lattice.cellCols; bc++) {
      for (const instance of lattice.blockInstances(bc, br, null)) {
        for (const direction of ['right', 'down']) {
          const next = lattice.neighbor(instance, direction, null);
          if (keys[instance.tileIndex] === keys[next.tileIndex]) count += 1;
        }
      }
    }
  }
  return count;
};

describe('tileCoverKey', () => {
  test('groups host cover variants and falls back to album then track', () => {
    assert.equal(
      tileCoverKey(tile(0, { coverUrl: 'echo-cover://thumb/abc' })),
      tileCoverKey(tile(1, { coverUrl: 'echo-cover://large/abc' })),
    );
    assert.equal(
      tileCoverKey(tile(2, { coverUrl: null, album: 'Same', artist: 'One' })),
      tileCoverKey(tile(3, { coverUrl: null, album: 'Same', artist: 'One' })),
    );
    assert.notEqual(
      tileCoverKey(tile(4, { coverUrl: null, album: '', trackId: 'a' })),
      tileCoverKey(tile(5, { coverUrl: null, album: '', trackId: 'b' })),
    );
  });
});

describe('spreadSlotToTile', () => {
  test('covers every tile and is deterministic', () => {
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i, { albumKey: i < 12 ? 'a' : 'b' }));
    const keys = tiles.map(tileCoverKey);
    const plan = planLatticeSlots(tiles.length, METRICS);
    const first = spreadSlotToTile(keys, plan);
    const second = spreadSlotToTile(keys, plan);
    assert.deepEqual(first, second);
    assert.equal(first.length, plan.cellSlotCount);
    assert.equal(new Set(first).size, tiles.length);
  });

  test('unique covers stay a bijection when the cell has no leftover slots', () => {
    const tiles = Array.from({ length: 12 }, (_, i) => tile(i, { albumKey: `solo-${i}` }));
    const plan = planLatticeSlots(tiles.length, METRICS);
    const mapping = spreadSlotToTile(tiles.map(tileCoverKey), plan);
    assert.deepEqual([...mapping].sort((a, b) => a - b), tiles.map((_, i) => i));
  });

  test('two albums sit farther apart than queue order', () => {
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i, { albumKey: i < 12 ? 'a' : 'b' }));
    const keys = tiles.map(tileCoverKey);
    const plan = planLatticeSlots(tiles.length, METRICS);
    const sequential = keys.map((_, i) => i % keys.length);
    const spread = spreadSlotToTile(keys, plan);
    const sequentialMin = minSameCoverDistance(sequential, keys, plan.centers, plan.cellPixelSize);
    const spreadMin = minSameCoverDistance(spread, keys, plan.centers, plan.cellPixelSize);
    assert.ok(spreadMin >= sequentialMin, `spread ${spreadMin} should not sit closer than sequential ${sequentialMin}`);

    const sequentialLattice = createLattice(tiles.length, METRICS);
    const spreadLattice = createLattice(tiles.length, METRICS, spread);
    const sequentialAdj = adjacentSameCoverCount(sequentialLattice, keys);
    const spreadAdj = adjacentSameCoverCount(spreadLattice, keys);
    assert.ok(spreadAdj < sequentialAdj, `spread neighbours ${spreadAdj} should be fewer than sequential ${sequentialAdj}`);
  });
});

describe('createSpreadLattice', () => {
  test('every queue index is addressable from the camera', () => {
    const tiles = Array.from({ length: 36 }, (_, i) => tile(i, { albumKey: `album-${i % 4}` }));
    const lattice = createSpreadLattice(tiles, METRICS);
    const point = { x: lattice.cellPixelSize.w * 0.3, y: lattice.cellPixelSize.h * 0.4 };
    for (let index = 0; index < tiles.length; index++) {
      const instance = lattice.nearestInstance(index, point, null);
      assert.equal(instance.tileIndex, index);
    }
  });

  test('pins the playing tile to a nearby square and still covers every tile', () => {
    const tiles = Array.from({ length: 36 }, (_, i) => tile(i, { albumKey: `album-${i % 6}` }));
    const plan = planLatticeSlots(tiles.length, METRICS);
    const near = plan.centers[0];
    const slot = pickSquareSlot(plan, near);
    const mapping = spreadSlotToTile(tiles.map(tileCoverKey), plan, { tileIndex: 3, slot });
    assert.equal(mapping[slot], 3);
    assert.equal(new Set(mapping).size, tiles.length);
    assert.equal(plan.rects[slot]?.w, plan.rects[slot]?.h);

    const lattice = createSpreadLattice(tiles, METRICS, { tileIndex: 3, near });
    const landed = lattice.nearestInstance(3, near, null);
    assert.equal(landed.tileIndex, 3);
    assert.equal(landed.rect.w, landed.rect.h);
  });

  test('repair does not move the pinned slot', () => {
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i, { albumKey: i < 16 ? 'a' : 'b' }));
    const plan = planLatticeSlots(tiles.length, METRICS);
    const slot = pickSquareSlot(plan, plan.centers[0]);
    const mapping = spreadSlotToTile(tiles.map(tileCoverKey), plan, { tileIndex: 0, slot });
    assert.equal(mapping[slot], 0);
  });
});

describe('reseatPlayingToSquare', () => {
  test('swaps only the playing tile onto a square in the same block', () => {
    const tiles = Array.from({ length: 36 }, (_, i) => tile(i, { albumKey: `album-${i % 6}` }));
    const lattice = createSpreadLattice(tiles, METRICS);
    const block = lattice.blockInstances(0, 0, null);
    const from = block.find((instance) => instance.rect.w !== instance.rect.h);
    assert.ok(from);
    const before = readSlotToTile(lattice);
    const mapping = reseatPlayingToSquare(lattice, from, from.tileIndex);
    const changed = before.filter((tileIndex, slot) => mapping[slot] !== tileIndex);
    assert.equal(changed.length, 2);
    assert.deepEqual([...mapping].sort((a, b) => a - b), [...before].sort((a, b) => a - b));

    const next = createLattice(tiles.length, METRICS, mapping);
    const seated = next.blockInstances(from.bc, from.br, null).find((instance) => instance.tileIndex === from.tileIndex);
    assert.ok(seated);
    assert.equal(seated.rect.w, seated.rect.h);
    assert.equal(seated.bc, from.bc);
    assert.equal(seated.br, from.br);
  });

  test('does nothing when the playing tile already sits on the nearest square', () => {
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i, { albumKey: `solo-${i}` }));
    const lattice = createSpreadLattice(tiles, METRICS);
    const square = lattice.blockInstances(0, 0, null).find((instance) => instance.rect.w === instance.rect.h);
    assert.ok(square);
    assert.deepEqual(reseatPlayingToSquare(lattice, square, square.tileIndex), readSlotToTile(lattice));
  });

  test('identity lattice (album wall) reseats a non-square playing tile in the same block', () => {
    const tiles = Array.from({ length: 36 }, (_, i) => tile(i, { albumKey: `album-${i}` }));
    const lattice = createLattice(tiles.length, METRICS);
    const from = lattice.blockInstances(0, 0, null).find((instance) => instance.rect.w !== instance.rect.h);
    assert.ok(from);
    const next = createLattice(tiles.length, METRICS, reseatPlayingToSquare(lattice, from, from.tileIndex));
    const seated = next.blockInstances(from.bc, from.br, null).find((instance) => instance.tileIndex === from.tileIndex);
    assert.ok(seated);
    assert.equal(seated.rect.w, seated.rect.h);
    assert.equal(seated.bc, from.bc);
    assert.equal(seated.br, from.br);
  });
});

describe('pickSquareSlot', () => {
  test('prefers the 4×4 whose centre we asked for', () => {
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i, { albumKey: `solo-${i}` }));
    const plan = planLatticeSlots(tiles.length, METRICS);
    const four = plan.rects.findIndex((rect) => rect.w === 4 && rect.h === 4);
    assert.ok(four >= 0);
    const center = plan.centers[four];
    assert.ok(center);
    assert.equal(pickSquareSlot(plan, center), four);
  });

  test('wraps a point from another periodic cell onto the same square', () => {
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i, { albumKey: `solo-${i}` }));
    const plan = planLatticeSlots(tiles.length, METRICS);
    const four = plan.rects.findIndex((rect) => rect.w === 4 && rect.h === 4);
    const center = plan.centers[four];
    assert.ok(center);
    assert.equal(
      pickSquareSlot(plan, {
        x: center.x + plan.cellPixelSize.w,
        y: center.y + plan.cellPixelSize.h,
      }),
      four,
    );
  });
});
