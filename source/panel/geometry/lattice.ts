/**
 * Pure geometry of the infinite wall (SPEC §5): a periodic cell of blocks, a hashed template + mirror
 * per world block, the pre-solved reflow for the block hosting the expanded card, culling, nearest
 * occurrence and keyboard neighbour search. No DOM, no host, no growing state.
 */

import {
  BLOCK_COLS,
  BLOCK_ROWS,
  EXPANDED_SIZE,
  SLOTS_PER_BLOCK,
  TEMPLATE_COUNT,
  type Direction,
  type GridRect,
  type Instance,
  type Lattice,
  type Metrics,
  type Mirror,
  type PixelRect,
  type Point,
} from '../types.ts';
import { BLOCK_TEMPLATES, mirrorFor, mirrorRect, templateIndexFor, type TemplateRect } from './blockTemplates.ts';
import reflows from './blockReflows.json' with { type: 'json' };

const MIRROR_COUNT = 4;
const VALUES_PER_RECT = 4;
const LAYOUT_STRIDE = SLOTS_PER_BLOCK * VALUES_PER_RECT;
const TEMPLATE_LAYOUT_COUNT = TEMPLATE_COUNT * MIRROR_COUNT;
const REFLOW_LAYOUT_COUNT = TEMPLATE_COUNT * SLOTS_PER_BLOCK * MIRROR_COUNT;
const DEFAULT_CULL_LIMIT = 250;
const ID_PATTERN = /^(0|[1-9]\d*):(0|-?[1-9]\d*):(0|-?[1-9]\d*)$/;

function templateLayoutOffset(template: number, mirror: Mirror): number {
  return (template * MIRROR_COUNT + mirror) * LAYOUT_STRIDE;
}

function reflowLayoutOffset(template: number, expandedSlot: number, mirror: Mirror): number {
  return (TEMPLATE_LAYOUT_COUNT + (template * SLOTS_PER_BLOCK + expandedSlot) * MIRROR_COUNT + mirror) * LAYOUT_STRIDE;
}

function readReflowTable(template: number, slot: number): TemplateRect[] {
  const table = reflows.tables[template]?.[slot];
  if (table === undefined || table.length !== SLOTS_PER_BLOCK) {
    throw new Error(`blockReflows.json has no table for template ${template} slot ${slot}`);
  }
  return table.map((values) => {
    const [col, row, w, h] = values;
    if (col === undefined || row === undefined || w === undefined || h === undefined) {
      throw new Error(`blockReflows.json has a malformed rect in template ${template} slot ${slot}`);
    }
    return { col, row, w, h };
  });
}

function writeLayout(out: Uint8Array, offset: number, rects: ReadonlyArray<TemplateRect>, mirror: Mirror): void {
  rects.forEach((rect, slot) => {
    const mirrored = mirrorRect(rect, mirror);
    const o = offset + slot * VALUES_PER_RECT;
    out[o] = mirrored.col;
    out[o + 1] = mirrored.row;
    out[o + 2] = mirrored.w;
    out[o + 3] = mirrored.h;
  });
}

/**
 * Every block-local layout the wall can show, flattened to `[col, row, w, h]` per slot: the 20
 * template × mirror variants first, then the 240 reflow × mirror variants. Mirroring a reflow table
 * is valid because reflection preserves both exact cover and slot order.
 */
function buildLayouts(): Uint8Array {
  if (reflows.block[0] !== BLOCK_COLS || reflows.block[1] !== BLOCK_ROWS || reflows.expanded !== EXPANDED_SIZE) {
    throw new Error('blockReflows.json was generated for a different block geometry; run `npm run reflows`');
  }
  const out = new Uint8Array((TEMPLATE_LAYOUT_COUNT + REFLOW_LAYOUT_COUNT) * LAYOUT_STRIDE);
  for (let t = 0; t < TEMPLATE_COUNT; t++) {
    const template = BLOCK_TEMPLATES[t];
    if (template === undefined) throw new Error(`Missing block template ${t}`);
    for (let m = 0; m < MIRROR_COUNT; m++) {
      writeLayout(out, templateLayoutOffset(t, m as Mirror), template, m as Mirror);
    }
    for (let s = 0; s < SLOTS_PER_BLOCK; s++) {
      const table = readReflowTable(t, s);
      for (let m = 0; m < MIRROR_COUNT; m++) {
        writeLayout(out, reflowLayoutOffset(t, s, m as Mirror), table, m as Mirror);
      }
    }
  }
  return out;
}

const LAYOUTS = buildLayouts();

function layoutValue(index: number): number {
  return LAYOUTS[index] ?? 0;
}

function mod(value: number, modulus: number): number {
  const remainder = value % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
}

function layoutOffsetFor(bc: number, br: number, expanded: Instance | null): number {
  const template = templateIndexFor(bc, br);
  const mirror = mirrorFor(bc, br);
  return expanded !== null && expanded.bc === bc && expanded.br === br
    ? reflowLayoutOffset(template, expanded.slot, mirror)
    : templateLayoutOffset(template, mirror);
}

/** Periodic cell size and origin-cell slot centres / rects for `tileCount` / `metrics`. */
export type LatticeSlotPlan = {
  tileCount: number;
  cellCols: number;
  cellRows: number;
  blocksPerCell: number;
  cellSlotCount: number;
  gridCols: number;
  gridRows: number;
  unit: number;
  cellPixelSize: { w: number; h: number };
  centers: Point[];
  /** Origin-cell grid rects, in the same order as `centers` (cellSlot 0..cellSlotCount-1). */
  rects: GridRect[];
};

/**
 * Geometry of one periodic cell, including the centre of every origin-cell slot. The queue wall
 * uses the centres to spread identical covers before `createLattice` binds the mapping.
 */
export function planLatticeSlots(tileCount: number, metrics: Metrics): LatticeSlotPlan {
  if (!Number.isInteger(tileCount) || tileCount < 1) {
    throw new RangeError(`tileCount must be a positive integer, got ${tileCount}`);
  }
  const { cell, gap } = metrics;
  if (!Number.isFinite(cell) || cell <= 0 || !Number.isFinite(gap) || gap < 0) {
    throw new RangeError(`metrics must satisfy cell > 0 and gap >= 0, got cell=${cell} gap=${gap}`);
  }

  const blocksNeeded = Math.ceil(tileCount / SLOTS_PER_BLOCK);
  const cellCols = Math.ceil(Math.sqrt(blocksNeeded));
  const cellRows = Math.ceil(blocksNeeded / cellCols);
  const blocksPerCell = cellCols * cellRows;
  const cellSlotCount = blocksPerCell * SLOTS_PER_BLOCK;
  const gridCols = cellCols * BLOCK_COLS;
  const gridRows = cellRows * BLOCK_ROWS;
  const unit = cell + gap;
  const cellPixelSize = {
    w: gridCols * unit,
    h: gridRows * unit,
  };
  const centers: Point[] = [];
  const rects: GridRect[] = [];
  for (let br = 0; br < cellRows; br++) {
    for (let bc = 0; bc < cellCols; bc++) {
      const offset = layoutOffsetFor(bc, br, null);
      for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) {
        const o = offset + slot * VALUES_PER_RECT;
        const rect = {
          col: bc * BLOCK_COLS + layoutValue(o),
          row: br * BLOCK_ROWS + layoutValue(o + 1),
          w: layoutValue(o + 2),
          h: layoutValue(o + 3),
        };
        rects.push(rect);
        centers.push({
          x: (rect.col + rect.w / 2) * unit - gap / 2,
          y: (rect.row + rect.h / 2) * unit - gap / 2,
        });
      }
    }
  }
  return {
    tileCount,
    cellCols,
    cellRows,
    blocksPerCell,
    cellSlotCount,
    gridCols,
    gridRows,
    unit,
    cellPixelSize,
    centers,
    rects,
  };
}

function resolveSlotToTile(
  tileCount: number,
  cellSlotCount: number,
  given: readonly number[] | undefined,
): { slotToTile: Int32Array; tileSlots: number[][] } {
  const slotToTile = new Int32Array(cellSlotCount);
  if (given === undefined) {
    for (let i = 0; i < cellSlotCount; i++) slotToTile[i] = i % tileCount;
  } else {
    if (given.length !== cellSlotCount) {
      throw new RangeError(`slotToTile length must be ${cellSlotCount}, got ${given.length}`);
    }
    const seen = new Uint8Array(tileCount);
    for (let i = 0; i < cellSlotCount; i++) {
      const tile = given[i];
      if (tile === undefined || !Number.isInteger(tile) || tile < 0 || tile >= tileCount) {
        throw new RangeError(`slotToTile[${i}] must be in 0..${tileCount - 1}, got ${tile}`);
      }
      slotToTile[i] = tile;
      seen[tile] = 1;
    }
    for (let t = 0; t < tileCount; t++) {
      if (seen[t] === 0) throw new RangeError(`slotToTile is missing tile ${t}`);
    }
  }
  const tileSlots: number[][] = Array.from({ length: tileCount }, () => []);
  for (let i = 0; i < cellSlotCount; i++) {
    const mapped = slotToTile[i];
    if (mapped !== undefined) tileSlots[mapped]?.push(i);
  }
  return { slotToTile, tileSlots };
}

export function createLattice(tileCount: number, metrics: Metrics, slotToTile?: readonly number[]): Lattice {
  const plan = planLatticeSlots(tileCount, metrics);
  const { cell, gap } = metrics;
  const { cellCols, cellRows, blocksPerCell, cellSlotCount, unit, cellPixelSize } = plan;
  const { slotToTile: tileAtSlot, tileSlots } = resolveSlotToTile(tileCount, cellSlotCount, slotToTile);

  // The cell is a full rectangle of blocks so the plane tiles without holes; leftover slots
  // show extra copies assigned by `slotToTile` (identity: `cellSlot % tileCount`).
  const blockPixelWidth = BLOCK_COLS * unit;
  const blockPixelHeight = BLOCK_ROWS * unit;
  const cellPixelWidth = cellPixelSize.w;
  const cellPixelHeight = cellPixelSize.h;

  const layoutOffset = layoutOffsetFor;

  const makeInstance = (bc: number, br: number, slot: number, offset: number): Instance => {
    const o = offset + slot * VALUES_PER_RECT;
    const blockInCell = mod(bc, cellCols) + mod(br, cellRows) * cellCols;
    const repeatX = Math.floor(bc / cellCols);
    const repeatY = Math.floor(br / cellRows);
    const cellSlot = blockInCell * SLOTS_PER_BLOCK + slot;
    return {
      id: `${cellSlot}:${repeatX}:${repeatY}`,
      cellSlot,
      blockInCell,
      slot,
      repeatX,
      repeatY,
      bc,
      br,
      tileIndex: tileAtSlot[cellSlot] ?? 0,
      rect: {
        col: bc * BLOCK_COLS + layoutValue(o),
        row: br * BLOCK_ROWS + layoutValue(o + 1),
        w: layoutValue(o + 2),
        h: layoutValue(o + 3),
      },
    };
  };

  /** Grid-unit centre column of a slot in a laid-out block (pixel centre = value·unit − gap/2). */
  const centreCol = (bc: number, o: number): number => bc * BLOCK_COLS + layoutValue(o) + layoutValue(o + 2) / 2;
  const centreRow = (br: number, o: number): number => br * BLOCK_ROWS + layoutValue(o + 1) + layoutValue(o + 3) / 2;

  const toPixels = (rect: GridRect): PixelRect => ({
    x: rect.col * unit,
    y: rect.row * unit,
    w: rect.w * cell + (rect.w - 1) * gap,
    h: rect.h * cell + (rect.h - 1) * gap,
  });

  const centerOf = (rect: GridRect): Point => ({
    x: (rect.col + rect.w / 2) * unit - gap / 2,
    y: (rect.row + rect.h / 2) * unit - gap / 2,
  });

  const instanceAt = (bc: number, br: number, slot: number, expanded: Instance | null): Instance =>
    makeInstance(bc, br, slot, layoutOffset(bc, br, expanded));

  const blockInstances = (bc: number, br: number, expanded: Instance | null): Instance[] => {
    const offset = layoutOffset(bc, br, expanded);
    const instances: Instance[] = [];
    for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) instances.push(makeInstance(bc, br, slot, offset));
    return instances;
  };

  const cull = (bounds: PixelRect, overscan: number, expanded: Instance | null, limit = DEFAULT_CULL_LIMIT): Instance[] => {
    const x0 = bounds.x - overscan;
    const y0 = bounds.y - overscan;
    const x1 = bounds.x + bounds.w + overscan;
    const y1 = bounds.y + bounds.h + overscan;
    const centreX = (x0 + x1) / 2;
    const centreY = (y0 + y1) / 2;
    const bcMin = Math.floor(x0 / blockPixelWidth);
    const bcMax = Math.floor(x1 / blockPixelWidth);
    const brMin = Math.floor(y0 / blockPixelHeight);
    const brMax = Math.floor(y1 / blockPixelHeight);

    const hits: { distance: number; instance: Instance }[] = [];
    for (let br = brMin; br <= brMax; br++) {
      for (let bc = bcMin; bc <= bcMax; bc++) {
        const offset = layoutOffset(bc, br, expanded);
        const originX = bc * blockPixelWidth;
        const originY = br * blockPixelHeight;
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) {
          const o = offset + slot * VALUES_PER_RECT;
          const x = originX + layoutValue(o) * unit;
          const y = originY + layoutValue(o + 1) * unit;
          const w = layoutValue(o + 2) * unit - gap;
          const h = layoutValue(o + 3) * unit - gap;
          if (x >= x1 || x + w <= x0 || y >= y1 || y + h <= y0) continue;
          const dx = x + w / 2 - centreX;
          const dy = y + h / 2 - centreY;
          hits.push({ distance: dx * dx + dy * dy, instance: makeInstance(bc, br, slot, offset) });
        }
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits.slice(0, limit).map((hit) => hit.instance);
  };

  const nearestInstance = (tileIndex: number, point: Point, expanded: Instance | null): Instance => {
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= tileCount) {
      throw new RangeError(`tileIndex must be in 0..${tileCount - 1}, got ${tileIndex}`);
    }
    let bestDistance = Infinity;
    let bestBc = 0;
    let bestBr = 0;
    let bestSlot = 0;
    let bestOffset = 0;
    const occurrences = tileSlots[tileIndex];
    if (occurrences === undefined || occurrences.length === 0) {
      throw new RangeError(`tileIndex ${tileIndex} has no slot in the periodic cell`);
    }
    for (const cellSlot of occurrences) {
      const slot = cellSlot % SLOTS_PER_BLOCK;
      const blockInCell = (cellSlot - slot) / SLOTS_PER_BLOCK;
      const cx = blockInCell % cellCols;
      const cy = (blockInCell - cx) / cellCols;
      // The card centre lies within half a block of the block centre and a cell is at least one
      // block in each direction, so the nearest repeat is within ±1 of the block-centre estimate.
      const rx0 = Math.round((point.x - (cx + 0.5) * blockPixelWidth) / cellPixelWidth);
      const ry0 = Math.round((point.y - (cy + 0.5) * blockPixelHeight) / cellPixelHeight);
      for (let ry = ry0 - 1; ry <= ry0 + 1; ry++) {
        for (let rx = rx0 - 1; rx <= rx0 + 1; rx++) {
          const bc = rx * cellCols + cx;
          const br = ry * cellRows + cy;
          const offset = layoutOffset(bc, br, expanded);
          const o = offset + slot * VALUES_PER_RECT;
          const dx = centreCol(bc, o) * unit - gap / 2 - point.x;
          const dy = centreRow(br, o) * unit - gap / 2 - point.y;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestBc = bc;
            bestBr = br;
            bestSlot = slot;
            bestOffset = offset;
          }
        }
      }
    }
    return makeInstance(bestBc, bestBr, bestSlot, bestOffset);
  };

  const fromId = (id: string, expanded: Instance | null): Instance | null => {
    const match = ID_PATTERN.exec(id);
    if (match === null) return null;
    const cellSlot = Number(match[1]);
    const repeatX = Number(match[2]);
    const repeatY = Number(match[3]);
    if (!Number.isSafeInteger(cellSlot) || !Number.isSafeInteger(repeatX) || !Number.isSafeInteger(repeatY)) return null;
    if (cellSlot >= blocksPerCell * SLOTS_PER_BLOCK) return null;
    const slot = cellSlot % SLOTS_PER_BLOCK;
    const blockInCell = (cellSlot - slot) / SLOTS_PER_BLOCK;
    const bc = repeatX * cellCols + (blockInCell % cellCols);
    const br = repeatY * cellRows + Math.floor(blockInCell / cellCols);
    return instanceAt(bc, br, slot, expanded);
  };

  const neighbor = (from: Instance, direction: Direction, expanded: Instance | null): Instance => {
    const fromOffset = layoutOffset(from.bc, from.br, expanded) + from.slot * VALUES_PER_RECT;
    const fromX = centreCol(from.bc, fromOffset);
    const fromY = centreRow(from.br, fromOffset);
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'right' || direction === 'down' ? 1 : -1;

    let bestScore = Infinity;
    let bestBc = 0;
    let bestBr = 0;
    let bestSlot = 0;
    let bestOffset = 0;
    for (let br = from.br - 1; br <= from.br + 1; br++) {
      for (let bc = from.bc - 1; bc <= from.bc + 1; bc++) {
        const offset = layoutOffset(bc, br, expanded);
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) {
          if (bc === from.bc && br === from.br && slot === from.slot) continue;
          const o = offset + slot * VALUES_PER_RECT;
          const dx = centreCol(bc, o) - fromX;
          const dy = centreRow(br, o) - fromY;
          const along = (horizontal ? dx : dy) * sign;
          if (along <= 1e-6) continue;
          const score = along + 2.5 * Math.abs(horizontal ? dy : dx);
          if (score < bestScore) {
            bestScore = score;
            bestBc = bc;
            bestBr = br;
            bestSlot = slot;
            bestOffset = offset;
          }
        }
      }
    }
    if (bestScore === Infinity) {
      const bc = horizontal ? from.bc + sign : from.bc;
      const br = horizontal ? from.br : from.br + sign;
      return instanceAt(bc, br, from.slot, expanded);
    }
    return makeInstance(bestBc, bestBr, bestSlot, bestOffset);
  };

  const sameBlock = (a: Instance, b: Instance): boolean => a.bc === b.bc && a.br === b.br;

  return {
    tileCount,
    metrics: { cell, gap },
    blocksPerCell,
    cellCols,
    cellRows,
    cellPixelSize: { w: cellPixelWidth, h: cellPixelHeight },
    unit,
    toPixels,
    centerOf,
    blockInstances,
    instanceAt,
    cull,
    nearestInstance,
    fromId,
    neighbor,
    sameBlock,
  };
}
