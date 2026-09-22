// Geometry tests (SPEC §14): templates, reflow tables, periodic cell, culling, nearest occurrence,
// keyboard neighbours and ids. Run with `node --test scripts/test-geometry.mjs`.

import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, test } from 'node:test';
import { BLOCK_COLS, BLOCK_ROWS, EXPANDED_SIZE, SLOTS_PER_BLOCK, TEMPLATE_COUNT } from '../source/panel/types.ts';
import {
  ALLOWED_SIZES,
  BLOCK_TEMPLATES,
  isAllowedSize,
  isExactCover,
  mirrorFor,
  mirrorRect,
  templateIndexFor,
} from '../source/panel/geometry/blockTemplates.ts';
import { createLattice } from '../source/panel/geometry/lattice.ts';
import reflows from '../source/panel/geometry/blockReflows.json' with { type: 'json' };

const METRICS = { cell: 104, gap: 8 };
const MIRRORS = [0, 1, 2, 3];
const TILE_COUNTS = [1, 5, 12, 13, 50, 500];
const DIRECTIONS = ['left', 'right', 'up', 'down'];
const reflowsPath = resolve(import.meta.dirname, '..', 'source', 'panel', 'geometry', 'blockReflows.json');

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function sizeKey(rect) {
  return `${rect.w}x${rect.h}`;
}

function reflowLayout(template, slot, mirror) {
  return reflows.tables[template][slot].map(([col, row, w, h]) => mirrorRect({ col, row, w, h }, mirror));
}

/** Instances of the 3×3 block neighbourhood centred on (bc, br). */
function neighbourhood(lattice, bc, br, expanded) {
  const instances = [];
  for (let y = br - 1; y <= br + 1; y++) {
    for (let x = bc - 1; x <= bc + 1; x++) instances.push(...lattice.blockInstances(x, y, expanded));
  }
  return instances;
}

function coversNeighbourhood(instances, bc, br) {
  const originCol = (bc - 1) * BLOCK_COLS;
  const originRow = (br - 1) * BLOCK_ROWS;
  const local = instances.map(({ rect }) => ({ ...rect, col: rect.col - originCol, row: rect.row - originRow }));
  return isExactCover(local, 3 * BLOCK_COLS, 3 * BLOCK_ROWS);
}

function grow(bounds, overscan) {
  return {
    x0: bounds.x - overscan,
    y0: bounds.y - overscan,
    x1: bounds.x + bounds.w + overscan,
    y1: bounds.y + bounds.h + overscan,
  };
}

function intersects(pixel, grown) {
  return pixel.x < grown.x1 && pixel.x + pixel.w > grown.x0 && pixel.y < grown.y1 && pixel.y + pixel.h > grown.y0;
}

function squaredDistance(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Every instance intersecting the grown bounds, found by scanning a generous block range. */
function bruteCull(lattice, bounds, overscan, expanded) {
  const grown = grow(bounds, overscan);
  const blockW = BLOCK_COLS * lattice.unit;
  const blockH = BLOCK_ROWS * lattice.unit;
  const found = [];
  for (let br = Math.floor(grown.y0 / blockH) - 2; br <= Math.floor(grown.y1 / blockH) + 2; br++) {
    for (let bc = Math.floor(grown.x0 / blockW) - 2; bc <= Math.floor(grown.x1 / blockW) + 2; bc++) {
      for (const instance of lattice.blockInstances(bc, br, expanded)) {
        if (intersects(lattice.toPixels(instance.rect), grown)) found.push(instance);
      }
    }
  }
  return found;
}

function bruteNearest(lattice, tileIndex, point, expanded) {
  let best = null;
  let bestDistance = Infinity;
  let ties = 0;
  for (let ry = -3; ry <= 3; ry++) {
    for (let rx = -3; rx <= 3; rx++) {
      for (let p = 0; p < lattice.blocksPerCell; p++) {
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) {
          const bc = rx * lattice.cellCols + (p % lattice.cellCols);
          const br = ry * lattice.cellRows + Math.floor(p / lattice.cellCols);
          const instance = lattice.instanceAt(bc, br, slot, expanded);
          if (instance.tileIndex !== tileIndex) continue;
          const distance = squaredDistance(lattice.centerOf(instance.rect), point);
          if (distance < bestDistance - 1e-9) {
            best = instance;
            bestDistance = distance;
            ties = 1;
          } else if (Math.abs(distance - bestDistance) <= 1e-9) {
            ties++;
          }
        }
      }
    }
  }
  return { best, bestDistance, ties };
}

describe('block templates', () => {
  test(`define ${TEMPLATE_COUNT} templates of ${SLOTS_PER_BLOCK} rects that exactly cover the block`, () => {
    assert.equal(BLOCK_TEMPLATES.length, TEMPLATE_COUNT);
    BLOCK_TEMPLATES.forEach((template, index) => {
      assert.equal(template.length, SLOTS_PER_BLOCK, `template ${index} slot count`);
      assert.ok(isExactCover(template), `template ${index} is not an exact cover`);
    });
  });

  test('respect the size rules: allowed sizes, a hero, two 2×2 cards, five distinct sizes', () => {
    assert.equal(ALLOWED_SIZES.length, 12);
    BLOCK_TEMPLATES.forEach((template, index) => {
      for (const rect of template) {
        assert.ok(isAllowedSize(rect.w, rect.h), `template ${index} uses ${sizeKey(rect)}`);
      }
      assert.ok(template.some((rect) => rect.w * rect.h >= 16), `template ${index} has no hero card`);
      assert.ok(template.filter((rect) => rect.w === 2 && rect.h === 2).length >= 2, `template ${index} needs two 2×2`);
      assert.ok(new Set(template.map(sizeKey)).size >= 5, `template ${index} needs five distinct sizes`);
    });
  });

  test('mirrorRect keeps exact cover, sizes and slot order for all four mirrors', () => {
    for (const template of BLOCK_TEMPLATES) {
      for (const mirror of MIRRORS) {
        const mirrored = template.map((rect) => mirrorRect(rect, mirror));
        assert.ok(isExactCover(mirrored), `mirror ${mirror} broke the cover`);
        mirrored.forEach((rect, slot) => assert.equal(sizeKey(rect), sizeKey(template[slot])));
      }
      assert.deepEqual(template.map((rect) => mirrorRect(rect, 0)), template);
      assert.deepEqual(
        template.map((rect) => mirrorRect(mirrorRect(rect, 1), 2)),
        template.map((rect) => mirrorRect(rect, 3)),
      );
    }
    assert.deepEqual(mirrorRect({ col: 1, row: 2, w: 3, h: 4 }, 1), { col: 8, row: 2, w: 3, h: 4 });
    assert.deepEqual(mirrorRect({ col: 1, row: 2, w: 3, h: 4 }, 2), { col: 1, row: 2, w: 3, h: 4 });
    assert.deepEqual(mirrorRect({ col: 1, row: 0, w: 3, h: 4 }, 3), { col: 8, row: 4, w: 3, h: 4 });
  });

  test('templateIndexFor is in range and differs for every adjacent block, negatives included', () => {
    for (let br = -7; br <= 7; br++) {
      for (let bc = -7; bc <= 7; bc++) {
        const index = templateIndexFor(bc, br);
        assert.ok(Number.isInteger(index) && index >= 0 && index < TEMPLATE_COUNT);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            assert.notEqual(templateIndexFor(bc + dx, br + dy), index, `blocks (${bc},${br}) and (${bc + dx},${br + dy})`);
          }
        }
      }
    }
    assert.equal(templateIndexFor(0, 0), 0);
    assert.equal(templateIndexFor(-1, 0), 4);
    assert.equal(templateIndexFor(0, -1), 3);
  });

  test('mirrorFor returns 0..3 and uses every mirror over a 20×20 range', () => {
    const counts = [0, 0, 0, 0];
    for (let br = -10; br < 10; br++) {
      for (let bc = -10; bc < 10; bc++) {
        const mirror = mirrorFor(bc, br);
        assert.ok(mirror === 0 || mirror === 1 || mirror === 2 || mirror === 3);
        assert.equal(mirrorFor(bc, br), mirror, 'deterministic');
        counts[mirror]++;
      }
    }
    assert.ok(counts.every((count) => count > 40), `unbalanced mirrors: ${counts.join(', ')}`);
  });
});

describe('reflow tables', () => {
  test('carry the expected metadata', () => {
    assert.equal(reflows.version, 1);
    assert.deepEqual(reflows.block, [BLOCK_COLS, BLOCK_ROWS]);
    assert.equal(reflows.expanded, EXPANDED_SIZE);
    assert.equal(reflows.lambda, 0.35);
    assert.equal(reflows.tables.length, TEMPLATE_COUNT);
    for (const table of reflows.tables) assert.equal(table.length, SLOTS_PER_BLOCK);
  });

  test('all 240 mirrored layouts are exact covers with a 6×6 at the expanded slot', () => {
    let checked = 0;
    for (let t = 0; t < TEMPLATE_COUNT; t++) {
      for (let s = 0; s < SLOTS_PER_BLOCK; s++) {
        for (const mirror of MIRRORS) {
          const layout = reflowLayout(t, s, mirror);
          const label = `template ${t} slot ${s} mirror ${mirror}`;
          assert.equal(layout.length, SLOTS_PER_BLOCK, label);
          assert.ok(isExactCover(layout), `${label} is not an exact cover`);
          assert.equal(layout[s].w, EXPANDED_SIZE, label);
          assert.equal(layout[s].h, EXPANDED_SIZE, label);
          layout.forEach((rect, slot) => {
            if (slot !== s) assert.ok(isAllowedSize(rect.w, rect.h), `${label} slot ${slot} is ${sizeKey(rect)}`);
          });
          checked++;
        }
      }
    }
    assert.equal(checked, 240);
  });

  test('blockReflows.json stays under 60 KB', () => {
    assert.ok(statSync(reflowsPath).size < 60 * 1024);
  });
});

describe('lattice cell', () => {
  test('createLattice rejects invalid arguments with RangeError', () => {
    for (const tileCount of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => createLattice(tileCount, METRICS), RangeError, `tileCount ${tileCount}`);
    }
    for (const metrics of [{ cell: 0, gap: 8 }, { cell: -1, gap: 8 }, { cell: NaN, gap: 8 }, { cell: 104, gap: -1 }, { cell: 104, gap: NaN }]) {
      assert.throws(() => createLattice(12, metrics), RangeError, JSON.stringify(metrics));
    }
  });

  test('cell dimensions form a full rectangle of blocks', () => {
    const expected = { 1: [1, 1], 5: [1, 1], 12: [1, 1], 13: [2, 1], 50: [3, 2], 500: [7, 6] };
    for (const tileCount of TILE_COUNTS) {
      const lattice = createLattice(tileCount, METRICS);
      const blocksNeeded = Math.ceil(tileCount / SLOTS_PER_BLOCK);
      assert.deepEqual([lattice.cellCols, lattice.cellRows], expected[tileCount], `tileCount ${tileCount}`);
      assert.equal(lattice.blocksPerCell, lattice.cellCols * lattice.cellRows);
      assert.ok(lattice.blocksPerCell >= blocksNeeded);
      assert.equal(lattice.unit, METRICS.cell + METRICS.gap);
      assert.deepEqual(lattice.cellPixelSize, {
        w: lattice.cellCols * BLOCK_COLS * lattice.unit,
        h: lattice.cellRows * BLOCK_ROWS * lattice.unit,
      });
      assert.deepEqual(lattice.metrics, METRICS);
      assert.equal(lattice.tileCount, tileCount);
    }
  });

  test('toPixels and centerOf follow the cell/gap formulas', () => {
    const lattice = createLattice(50, METRICS);
    const rect = { col: -3, row: 5, w: 4, h: 2 };
    assert.deepEqual(lattice.toPixels(rect), { x: -3 * 112, y: 5 * 112, w: 4 * 104 + 3 * 8, h: 2 * 104 + 8 });
    const pixels = lattice.toPixels(rect);
    assert.deepEqual(lattice.centerOf(rect), { x: pixels.x + pixels.w / 2, y: pixels.y + pixels.h / 2 });
  });

  for (const tileCount of TILE_COUNTS) {
    describe(`tileCount ${tileCount}`, () => {
      const lattice = createLattice(tileCount, METRICS);
      const centres = [
        [0, 0],
        [-4, -3],
        [7, -2],
        [-9, 11],
      ];

      test('3×3 block neighbourhoods never overlap and exactly cover their area', () => {
        for (const [bc, br] of centres) {
          const instances = neighbourhood(lattice, bc, br, null);
          assert.equal(instances.length, 9 * SLOTS_PER_BLOCK);
          assert.equal(new Set(instances.map((instance) => instance.id)).size, instances.length, 'ids are unique');
          assert.ok(coversNeighbourhood(instances, bc, br), `neighbourhood around (${bc},${br})`);
          for (const instance of instances) {
            assert.ok(isAllowedSize(instance.rect.w, instance.rect.h));
            assert.ok(instance.tileIndex >= 0 && instance.tileIndex < tileCount);
            assert.equal(instance.tileIndex, instance.cellSlot % tileCount);
            assert.equal(instance.cellSlot, instance.blockInCell * SLOTS_PER_BLOCK + instance.slot);
            assert.equal(instance.bc, instance.repeatX * lattice.cellCols + (instance.blockInCell % lattice.cellCols));
            assert.equal(instance.br, instance.repeatY * lattice.cellRows + Math.floor(instance.blockInCell / lattice.cellCols));
          }
        }
      });

      test('3×3 block neighbourhoods stay an exact cover with an expanded card', () => {
        for (const [bc, br] of centres) {
          for (const slot of [0, 5, 11]) {
            const expanded = lattice.instanceAt(bc, br, slot, null);
            const instances = neighbourhood(lattice, bc, br, expanded);
            assert.ok(coversNeighbourhood(instances, bc, br), `expanded slot ${slot} around (${bc},${br})`);
          }
        }
      });

      test('shifting a block by one cell keeps the tile and moves the block by the cell size', () => {
        for (const [bc, br] of centres) {
          for (const slot of [0, 3, 11]) {
            const base = lattice.instanceAt(bc, br, slot, null);
            const right = lattice.instanceAt(bc + lattice.cellCols, br, slot, null);
            const down = lattice.instanceAt(bc, br + lattice.cellRows, slot, null);
            for (const shifted of [right, down]) {
              assert.equal(shifted.tileIndex, base.tileIndex);
              assert.equal(shifted.cellSlot, base.cellSlot);
              assert.equal(shifted.blockInCell, base.blockInCell);
              assert.equal(shifted.slot, slot);
            }
            assert.equal(right.repeatX, base.repeatX + 1);
            assert.equal(right.repeatY, base.repeatY);
            assert.equal(down.repeatX, base.repeatX);
            assert.equal(down.repeatY, base.repeatY + 1);
            // The block origin shifts by exactly one cell; the block-local rect may differ because
            // template and mirror are hashed from world block coordinates.
            const localCol = (instance) => instance.rect.col - instance.bc * BLOCK_COLS;
            const localRow = (instance) => instance.rect.row - instance.br * BLOCK_ROWS;
            assert.equal(right.bc, bc + lattice.cellCols);
            assert.equal(down.br, br + lattice.cellRows);
            for (const instance of [base, right, down]) {
              assert.ok(localCol(instance) >= 0 && localCol(instance) + instance.rect.w <= BLOCK_COLS);
              assert.ok(localRow(instance) >= 0 && localRow(instance) + instance.rect.h <= BLOCK_ROWS);
            }
            if (right.rect.w === base.rect.w && right.rect.h === base.rect.h && localCol(right) === localCol(base)) {
              assert.equal(right.rect.col, base.rect.col + lattice.cellCols * BLOCK_COLS);
            }
          }
        }
      });

      test('every tile index appears in one cell', () => {
        const seen = new Set();
        for (let p = 0; p < lattice.blocksPerCell; p++) {
          const bc = p % lattice.cellCols;
          const br = Math.floor(p / lattice.cellCols);
          for (const instance of lattice.blockInstances(bc, br, null)) {
            assert.equal(instance.blockInCell, p);
            assert.equal(instance.repeatX, 0);
            assert.equal(instance.repeatY, 0);
            seen.add(instance.tileIndex);
          }
        }
        assert.equal(seen.size, tileCount);
      });
    });
  }
});

describe('cull', () => {
  const lattice = createLattice(50, METRICS);
  const bounds = { x: 1000, y: 800, w: 1920, h: 1080 };
  const overscan = 500;
  const grown = grow(bounds, overscan);
  const centre = { x: (grown.x0 + grown.x1) / 2, y: (grown.y0 + grown.y1) / 2 };

  test('returns exactly the instances intersecting the grown bounds, nearest first', () => {
    const expected = bruteCull(lattice, bounds, overscan, null);
    const result = lattice.cull(bounds, overscan, null, 100_000);
    assert.equal(result.length, expected.length);
    assert.ok(result.length > 0);
    assert.deepEqual(new Set(result.map((instance) => instance.id)), new Set(expected.map((instance) => instance.id)));
    let previous = -1;
    for (const instance of result) {
      assert.ok(intersects(lattice.toPixels(instance.rect), grown));
      const distance = squaredDistance(lattice.centerOf(instance.rect), centre);
      assert.ok(distance >= previous, 'sorted nearest first');
      previous = distance;
    }
  });

  test('respects the limit and the default limit of 250', () => {
    const all = lattice.cull(bounds, overscan, null, 100_000);
    const limited = lattice.cull(bounds, overscan, null, 20);
    assert.equal(limited.length, 20);
    assert.deepEqual(limited.map((instance) => instance.id), all.slice(0, 20).map((instance) => instance.id));
    assert.equal(lattice.cull(bounds, overscan, null).length, Math.min(250, all.length));
    const big = createLattice(500, METRICS).cull({ x: 0, y: 0, w: 3840, h: 2160 }, 500, null);
    assert.ok(big.length > 100 && big.length <= 250, `4K cull returned ${big.length}`);
  });

  test('has the expected count for a known viewport', () => {
    // Grown bounds 500..3420 × 300..2380 px touch blocks 0..2 on both axes (1344 × 896 px per block);
    // block (1,1) lies fully inside, so all of its 12 cards must be present.
    const result = lattice.cull(bounds, overscan, null, 100_000);
    const blocks = new Set(result.map((instance) => `${instance.bc},${instance.br}`));
    assert.equal(blocks.size, 9);
    assert.equal(result.filter((instance) => instance.bc === 1 && instance.br === 1).length, SLOTS_PER_BLOCK);
    assert.ok(result.length > SLOTS_PER_BLOCK && result.length < 9 * SLOTS_PER_BLOCK);

    // Bounds aligned to exactly 2 × 2 blocks with no overscan: precisely those 48 cards intersect.
    const aligned = { x: 0, y: 0, w: 2 * BLOCK_COLS * lattice.unit, h: 2 * BLOCK_ROWS * lattice.unit };
    const exact = lattice.cull(aligned, 0, null, 100_000);
    assert.equal(exact.length, 4 * SLOTS_PER_BLOCK);
    assert.ok(exact.every((instance) => instance.bc >= 0 && instance.bc <= 1 && instance.br >= 0 && instance.br <= 1));
  });

  test('culling with an expanded card changes only that block', () => {
    const plain = lattice.cull(bounds, overscan, null, 100_000);
    const expanded = plain[0];
    const withExpanded = lattice.cull(bounds, overscan, expanded, 100_000);
    const plainById = new Map(plain.map((instance) => [instance.id, instance]));
    const expandedById = new Map(withExpanded.map((instance) => [instance.id, instance]));
    const outside = (instance) => !lattice.sameBlock(instance, expanded);
    assert.deepEqual(
      plain.filter(outside).map((instance) => instance.id).sort(),
      withExpanded.filter(outside).map((instance) => instance.id).sort(),
    );
    for (const instance of withExpanded.filter(outside)) assert.deepEqual(instance, plainById.get(instance.id));
    const grownExpanded = expandedById.get(expanded.id);
    assert.ok(grownExpanded, 'the expanded card stays in view');
    assert.equal(grownExpanded.rect.w, EXPANDED_SIZE);
    assert.equal(grownExpanded.rect.h, EXPANDED_SIZE);
    assert.ok(withExpanded.every((instance) => intersects(lattice.toPixels(instance.rect), grown)));
  });
});

describe('nearestInstance', () => {
  test('matches brute force over repeats −3..+3 for random points and tiles', () => {
    const random = mulberry32(0x1a77ce);
    for (const tileCount of TILE_COUNTS) {
      const lattice = createLattice(tileCount, METRICS);
      const expandedOptions = [null, lattice.instanceAt(0, 0, 5, null), lattice.instanceAt(-1, 1, 0, null)];
      for (let i = 0; i < 40; i++) {
        const tileIndex = Math.floor(random() * tileCount);
        const point = {
          x: (random() * 3 - 1.5) * lattice.cellPixelSize.w,
          y: (random() * 3 - 1.5) * lattice.cellPixelSize.h,
        };
        const expanded = expandedOptions[i % expandedOptions.length];
        const result = lattice.nearestInstance(tileIndex, point, expanded);
        const brute = bruteNearest(lattice, tileIndex, point, expanded);
        const label = `tileCount ${tileCount} tile ${tileIndex} point (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`;
        assert.equal(result.tileIndex, tileIndex, label);
        const distance = squaredDistance(lattice.centerOf(result.rect), point);
        assert.ok(Math.abs(distance - brute.bestDistance) <= 1e-6, `${label}: ${distance} vs ${brute.bestDistance}`);
        if (brute.ties === 1) assert.equal(result.id, brute.best.id, label);
        assert.deepEqual(result, lattice.instanceAt(result.bc, result.br, result.slot, expanded));
      }
    }
  });

  test('rejects tile indices outside the queue', () => {
    const lattice = createLattice(13, METRICS);
    assert.throws(() => lattice.nearestInstance(13, { x: 0, y: 0 }, null), RangeError);
    assert.throws(() => lattice.nearestInstance(-1, { x: 0, y: 0 }, null), RangeError);
  });
});

describe('neighbor', () => {
  const lattice = createLattice(50, METRICS);
  const blocks = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [-3, 2],
    [6, -5],
  ];

  test('never returns the origin, moves in the requested direction and stays adjacent', () => {
    for (const [bc, br] of blocks) {
      for (const expanded of [null, lattice.instanceAt(bc, br, 4, null)]) {
        for (const from of lattice.blockInstances(bc, br, expanded)) {
          const fromCentre = lattice.centerOf(from.rect);
          for (const direction of DIRECTIONS) {
            const next = lattice.neighbor(from, direction, expanded);
            const label = `${from.id} ${direction}`;
            assert.notEqual(next.id, from.id, label);
            assert.ok(Math.abs(next.bc - from.bc) <= 1 && Math.abs(next.br - from.br) <= 1, label);
            assert.deepEqual(next, lattice.instanceAt(next.bc, next.br, next.slot, expanded), label);
            const nextCentre = lattice.centerOf(next.rect);
            if (direction === 'right') assert.ok(nextCentre.x > fromCentre.x, label);
            if (direction === 'left') assert.ok(nextCentre.x < fromCentre.x, label);
            if (direction === 'down') assert.ok(nextCentre.y > fromCentre.y, label);
            if (direction === 'up') assert.ok(nextCentre.y < fromCentre.y, label);
          }
        }
      }
    }
  });

  test('left then right round-trips from a centred card for at least one template', () => {
    let roundTrips = 0;
    for (let template = 0; template < TEMPLATE_COUNT; template++) {
      const instances = lattice.blockInstances(template, 0, null);
      const blockCentre = { x: (template * BLOCK_COLS + BLOCK_COLS / 2) * lattice.unit, y: (BLOCK_ROWS / 2) * lattice.unit };
      const centred = instances.reduce((best, instance) =>
        squaredDistance(lattice.centerOf(instance.rect), blockCentre) < squaredDistance(lattice.centerOf(best.rect), blockCentre)
          ? instance
          : best,
      );
      const back = lattice.neighbor(lattice.neighbor(centred, 'left', null), 'right', null);
      if (back.id === centred.id) roundTrips++;
    }
    assert.ok(roundTrips >= 1, `round trips: ${roundTrips}`);
  });
});

describe('fromId', () => {
  const lattice = createLattice(50, METRICS);
  const positions = [
    [0, 0, 0],
    [0, 0, 11],
    [2, 1, 7],
    [-1, -1, 3],
    [-7, 4, 5],
    [13, -9, 10],
  ];

  test('round-trips ids produced by instanceAt with and without an expanded card', () => {
    const expanded = lattice.instanceAt(2, 1, 7, null);
    for (const [bc, br, slot] of positions) {
      const plain = lattice.instanceAt(bc, br, slot, null);
      assert.deepEqual(lattice.fromId(plain.id, null), plain);
      const reflowed = lattice.instanceAt(bc, br, slot, expanded);
      assert.deepEqual(lattice.fromId(plain.id, expanded), reflowed);
      assert.equal(reflowed.id, plain.id);
    }
    for (const instance of lattice.cull({ x: -3000, y: -2000, w: 6000, h: 4000 }, 0, null, 100_000)) {
      assert.deepEqual(lattice.fromId(instance.id, null), instance);
    }
  });

  test('returns null for malformed or out-of-range ids', () => {
    const outOfRange = `${lattice.blocksPerCell * SLOTS_PER_BLOCK}:0:0`;
    const malformed = ['', '1', '1:2', '1:2:3:4', 'a:0:0', '1.5:0:0', '-1:0:0', ' 1:0:0', '1:0:0 ', '01:0:0', '1:-0:0', '1:+1:0', '1e3:0:0', '1:2:', ':1:2', outOfRange, '99999999999999999999:0:0'];
    for (const id of malformed) assert.equal(lattice.fromId(id, null), null, JSON.stringify(id));
    assert.notEqual(lattice.fromId(`${lattice.blocksPerCell * SLOTS_PER_BLOCK - 1}:-3:7`, null), null);
  });
});

describe('expansion', () => {
  test('the expanded block returns a 6×6 at the expanded slot with unchanged tiles and slot order', () => {
    for (const tileCount of TILE_COUNTS) {
      const lattice = createLattice(tileCount, METRICS);
      for (const [bc, br] of [[2, -1], [-5, 3], [0, 0]]) {
        const base = lattice.blockInstances(bc, br, null);
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) {
          const expanded = base[slot];
          const block = lattice.blockInstances(bc, br, expanded);
          assert.equal(block.length, SLOTS_PER_BLOCK);
          assert.equal(block[slot].rect.w, EXPANDED_SIZE);
          assert.equal(block[slot].rect.h, EXPANDED_SIZE);
          block.forEach((instance, index) => {
            assert.equal(instance.slot, index);
            assert.equal(instance.id, base[index].id);
            assert.equal(instance.tileIndex, base[index].tileIndex);
            assert.equal(instance.bc, bc);
            assert.equal(instance.br, br);
            if (index !== slot) assert.ok(isAllowedSize(instance.rect.w, instance.rect.h));
          });
          const local = block.map(({ rect }) => ({ ...rect, col: rect.col - bc * BLOCK_COLS, row: rect.row - br * BLOCK_ROWS }));
          assert.ok(isExactCover(local), `tileCount ${tileCount} block (${bc},${br}) slot ${slot}`);
          assert.deepEqual(lattice.instanceAt(bc, br, slot, expanded), block[slot]);
          assert.deepEqual(lattice.blockInstances(bc + 1, br, expanded), lattice.blockInstances(bc + 1, br, null));
        }
      }
    }
  });

  test('sameBlock compares world block coordinates only', () => {
    const lattice = createLattice(50, METRICS);
    const a = lattice.instanceAt(1, 2, 0, null);
    assert.ok(lattice.sameBlock(a, lattice.instanceAt(1, 2, 11, null)));
    assert.ok(!lattice.sameBlock(a, lattice.instanceAt(2, 2, 0, null)));
    assert.ok(!lattice.sameBlock(a, lattice.instanceAt(1 + lattice.cellCols, 2, 0, null)));
  });
});

describe('slotToTile mapping', () => {
  test('rejects mappings that are the wrong length or drop a tile', () => {
    const slotCount = 2 * 12;
    assert.throws(() => createLattice(13, METRICS, [0]), RangeError);
    assert.throws(() => createLattice(13, METRICS, Array.from({ length: slotCount }, (_, i) => i % 12)), RangeError);
  });

  test('nearestInstance follows a custom mapping', () => {
    const tileCount = 13;
    const slotCount = 2 * 12;
    const mapping = Array.from({ length: slotCount }, (_, i) => (tileCount - 1 - (i % tileCount) + tileCount) % tileCount);
    // Ensure every tile appears at least once (24 slots, 13 tiles).
    const seen = new Set(mapping);
    assert.equal(seen.size, tileCount);
    const lattice = createLattice(tileCount, METRICS, mapping);
    const origin = lattice.instanceAt(0, 0, 0, null);
    assert.equal(origin.tileIndex, mapping[0]);
    const lastSlot = lattice.instanceAt(1, 0, 11, null);
    assert.equal(lastSlot.tileIndex, mapping[23]);
    const point = lattice.centerOf(origin.rect);
    const nearest = lattice.nearestInstance(origin.tileIndex, point, null);
    assert.equal(nearest.tileIndex, origin.tileIndex);
    assert.equal(nearest.id, origin.id);
    const brute = bruteNearest(lattice, origin.tileIndex, { x: 10, y: 20 }, null);
    const result = lattice.nearestInstance(origin.tileIndex, { x: 10, y: 20 }, null);
    assert.ok(Math.abs(squaredDistance(lattice.centerOf(result.rect), { x: 10, y: 20 }) - brute.bestDistance) <= 1e-6);
  });
});

describe('performance', () => {
  test('4K cull with overscan 500 runs under 50 ms after one warm-up call', () => {
    const lattice = createLattice(500, METRICS);
    const bounds = { x: 12_345, y: -6_789, w: 3840, h: 2160 };
    lattice.cull(bounds, 500, null);
    const started = performance.now();
    const result = lattice.cull(bounds, 500, null);
    const elapsed = performance.now() - started;
    assert.ok(result.length > 0 && result.length <= 250);
    assert.ok(elapsed < 50, `cull took ${elapsed.toFixed(2)} ms`);
  });
});
