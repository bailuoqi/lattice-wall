/**
 * Card shape rules shared by the offline layout solver (`scripts/generate-reflows.mjs`) and the
 * runtime. No generated data is imported here, so the solver can run before any layout exists.
 */

import { BLOCK_COLS, BLOCK_ROWS } from '../types.ts';

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
  [6, 3],
  [3, 6],
  [6, 4],
  [4, 6],
];

export function isAllowedSize(w: number, h: number): boolean {
  for (const size of ALLOWED_SIZES) {
    if (size[0] === w && size[1] === h) return true;
  }
  return false;
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
