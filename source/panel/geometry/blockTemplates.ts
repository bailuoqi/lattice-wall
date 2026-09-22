/**
 * Hand-designed block templates for the Lattice Wall (SPEC §5).
 *
 * A block is BLOCK_COLS × BLOCK_ROWS grid cells holding exactly SLOTS_PER_BLOCK cards. Each template
 * lists its 12 rects in reading order (row-major by top-left corner) so consecutive queue items flow
 * left-to-right, top-to-bottom through the block. The five templates put their hero card in
 * different places (left, right, centre, top, bottom); mirroring multiplies that into 20 looks.
 */

import { BLOCK_COLS, BLOCK_ROWS, SLOTS_PER_BLOCK, TEMPLATE_COUNT, type Mirror } from '../types.ts';

export type TemplateRect = { col: number; row: number; w: number; h: number };

/** Card sizes (w × h, grid cells) a template or reflow layout may use. */
export const ALLOWED_SIZES: ReadonlyArray<readonly [w: number, h: number]> = [
  [2, 2],
  [2, 3],
  [3, 2],
  [2, 4],
  [4, 2],
  [3, 4],
  [4, 3],
  [4, 4],
  [6, 2],
  [2, 6],
  [6, 4],
  [4, 6],
];

export function isAllowedSize(w: number, h: number): boolean {
  for (const size of ALLOWED_SIZES) {
    if (size[0] === w && size[1] === h) return true;
  }
  return false;
}

// Template 0 — hero left (6×4), a 4×4 beside it and a 2×6 pillar on the right edge.
//   A A A A A A B B B B C C
//   A A A A A A B B B B C C
//   A A A A A A B B B B C C
//   A A A A A A B B B B C C
//   D D E E E F F F G G C C
//   D D E E E F F F G G C C
//   H H H H I I J J K K L L
//   H H H H I I J J K K L L
const TEMPLATE_HERO_LEFT: readonly TemplateRect[] = [
  { col: 0, row: 0, w: 6, h: 4 },
  { col: 6, row: 0, w: 4, h: 4 },
  { col: 10, row: 0, w: 2, h: 6 },
  { col: 0, row: 4, w: 2, h: 2 },
  { col: 2, row: 4, w: 3, h: 2 },
  { col: 5, row: 4, w: 3, h: 2 },
  { col: 8, row: 4, w: 2, h: 2 },
  { col: 0, row: 6, w: 4, h: 2 },
  { col: 4, row: 6, w: 2, h: 2 },
  { col: 6, row: 6, w: 2, h: 2 },
  { col: 8, row: 6, w: 2, h: 2 },
  { col: 10, row: 6, w: 2, h: 2 },
];

// Template 1 — hero right (4×6 portrait) with two 4×3 landscape cards stacked on the left.
//   A A B B B C C C D D D D
//   A A B B B C C C D D D D
//   E E E E F F G G D D D D
//   E E E E F F G G D D D D
//   E E E E H H G G D D D D
//   I I I I H H G G D D D D
//   I I I I J J J J K K L L
//   I I I I J J J J K K L L
const TEMPLATE_HERO_RIGHT: readonly TemplateRect[] = [
  { col: 0, row: 0, w: 2, h: 2 },
  { col: 2, row: 0, w: 3, h: 2 },
  { col: 5, row: 0, w: 3, h: 2 },
  { col: 8, row: 0, w: 4, h: 6 },
  { col: 0, row: 2, w: 4, h: 3 },
  { col: 4, row: 2, w: 2, h: 2 },
  { col: 6, row: 2, w: 2, h: 4 },
  { col: 4, row: 4, w: 2, h: 2 },
  { col: 0, row: 5, w: 4, h: 3 },
  { col: 4, row: 6, w: 4, h: 2 },
  { col: 8, row: 6, w: 2, h: 2 },
  { col: 10, row: 6, w: 2, h: 2 },
];

// Template 2 — hero centre (4×4) framed by banners above and below and pillars on the left.
//   A A A B B B B B B C C C
//   A A A B B B B B B C C C
//   D D E E F F F F G G G G
//   D D E E F F F F G G G G
//   D D E E F F F F H H I I
//   D D E E F F F F H H I I
//   J J J J J J K K K K L L
//   J J J J J J K K K K L L
const TEMPLATE_HERO_CENTRE: readonly TemplateRect[] = [
  { col: 0, row: 0, w: 3, h: 2 },
  { col: 3, row: 0, w: 6, h: 2 },
  { col: 9, row: 0, w: 3, h: 2 },
  { col: 0, row: 2, w: 2, h: 4 },
  { col: 2, row: 2, w: 2, h: 4 },
  { col: 4, row: 2, w: 4, h: 4 },
  { col: 8, row: 2, w: 4, h: 2 },
  { col: 8, row: 4, w: 2, h: 2 },
  { col: 10, row: 4, w: 2, h: 2 },
  { col: 0, row: 6, w: 6, h: 2 },
  { col: 6, row: 6, w: 4, h: 2 },
  { col: 10, row: 6, w: 2, h: 2 },
];

// Template 3 — hero top (6×4) flanked by two 3×4 portraits, small cards along the bottom.
//   A A A B B B B B B C C C
//   A A A B B B B B B C C C
//   A A A B B B B B B C C C
//   A A A B B B B B B C C C
//   D D E E F F F G G G H H
//   D D E E F F F G G G H H
//   I I J J J J K K L L H H
//   I I J J J J K K L L H H
const TEMPLATE_HERO_TOP: readonly TemplateRect[] = [
  { col: 0, row: 0, w: 3, h: 4 },
  { col: 3, row: 0, w: 6, h: 4 },
  { col: 9, row: 0, w: 3, h: 4 },
  { col: 0, row: 4, w: 2, h: 2 },
  { col: 2, row: 4, w: 2, h: 2 },
  { col: 4, row: 4, w: 3, h: 2 },
  { col: 7, row: 4, w: 3, h: 2 },
  { col: 10, row: 4, w: 2, h: 4 },
  { col: 0, row: 6, w: 2, h: 2 },
  { col: 2, row: 6, w: 4, h: 2 },
  { col: 6, row: 6, w: 2, h: 2 },
  { col: 8, row: 6, w: 2, h: 2 },
];

// Template 4 — hero bottom (6×4), a 4×4 top right, two staggered 2×3 portraits on the left edge.
//   A A B B B B C C C C D D
//   A A B B B B C C C C D D
//   A A E E E E C C C C D D
//   F F E E E E C C C C D D
//   F F G G H H H H H H I I
//   F F G G H H H H H H I I
//   J J K K H H H H H H L L
//   J J K K H H H H H H L L
const TEMPLATE_HERO_BOTTOM: readonly TemplateRect[] = [
  { col: 0, row: 0, w: 2, h: 3 },
  { col: 2, row: 0, w: 4, h: 2 },
  { col: 6, row: 0, w: 4, h: 4 },
  { col: 10, row: 0, w: 2, h: 4 },
  { col: 2, row: 2, w: 4, h: 2 },
  { col: 0, row: 3, w: 2, h: 3 },
  { col: 2, row: 4, w: 2, h: 2 },
  { col: 4, row: 4, w: 6, h: 4 },
  { col: 10, row: 4, w: 2, h: 2 },
  { col: 0, row: 6, w: 2, h: 2 },
  { col: 2, row: 6, w: 2, h: 2 },
  { col: 10, row: 6, w: 2, h: 2 },
];

export const BLOCK_TEMPLATES: ReadonlyArray<ReadonlyArray<TemplateRect>> = [
  TEMPLATE_HERO_LEFT,
  TEMPLATE_HERO_RIGHT,
  TEMPLATE_HERO_CENTRE,
  TEMPLATE_HERO_TOP,
  TEMPLATE_HERO_BOTTOM,
];

if (BLOCK_TEMPLATES.length !== TEMPLATE_COUNT) {
  throw new Error(`BLOCK_TEMPLATES must define ${TEMPLATE_COUNT} templates`);
}
for (const template of BLOCK_TEMPLATES) {
  if (template.length !== SLOTS_PER_BLOCK) {
    throw new Error(`Every block template must define ${SLOTS_PER_BLOCK} slots`);
  }
}

/** Reflect a block-local rect inside the block; the slot order of a layout is unaffected. */
export function mirrorRect(rect: TemplateRect, mirror: Mirror): TemplateRect {
  return {
    col: (mirror & 1) !== 0 ? BLOCK_COLS - rect.col - rect.w : rect.col,
    row: (mirror & 2) !== 0 ? BLOCK_ROWS - rect.row - rect.h : rect.row,
    w: rect.w,
    h: rect.h,
  };
}

function mod(value: number, modulus: number): number {
  const remainder = value % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
}

/**
 * Template for a world block. `(bc + 2·br) mod 5` differs from all eight neighbours, since the
 * differences ±1, ±2, ±3 are never 0 modulo 5.
 */
export function templateIndexFor(bc: number, br: number): number {
  return mod(bc + 2 * br, TEMPLATE_COUNT);
}

/**
 * Mirror for a world block: a 32-bit multiply–xorshift mix of the two coordinates. Each input is
 * scaled by its own odd constant, then two rounds of xorshift-multiply spread every input bit into
 * the top bits, which select the mirror (the top bits are the best mixed).
 */
export function mirrorFor(bc: number, br: number): Mirror {
  let h = Math.imul(bc | 0, 0x27d4eb2f) ^ Math.imul(br | 0, 0x165667b1) ^ 0x3c6ef372;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 30) as Mirror;
}

/** True when `rects` tile the `cols × rows` area with no gap and no overlap. */
export function isExactCover(rects: ReadonlyArray<TemplateRect>, cols = BLOCK_COLS, rows = BLOCK_ROWS): boolean {
  const covered = new Uint8Array(cols * rows);
  let filled = 0;
  for (const { col, row, w, h } of rects) {
    if (!Number.isInteger(col) || !Number.isInteger(row) || !Number.isInteger(w) || !Number.isInteger(h)) return false;
    if (w < 1 || h < 1 || col < 0 || row < 0 || col + w > cols || row + h > rows) return false;
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        const index = r * cols + c;
        if (covered[index] === 1) return false;
        covered[index] = 1;
        filled++;
      }
    }
  }
  return filled === cols * rows;
}
