/**
 * Block templates and expansion reflows (SPEC §5), searched offline by `scripts/generate-reflows.mjs`
 * on the whole BLOCK_COLS × BLOCK_ROWS block rather than hand-drawn in a 12×8 box.
 *
 * Each template lists its SLOTS_PER_BLOCK rects in reading order (row-major by top-left corner) so
 * consecutive queue items flow left-to-right, top-to-bottom. Mirroring multiplies the templates into
 * TEMPLATE_COUNT × 4 looks. A reflow is stored as the rects that change when one slot grows to
 * EXPANDED_SIZE × EXPANDED_SIZE; every other card keeps its template rect.
 */

import { BLOCK_COLS, BLOCK_ROWS, EXPANDED_SIZE, SLOTS_PER_BLOCK, TEMPLATE_COUNT, type Mirror } from '../types.ts';
import { type TemplateRect } from './blockShapes.ts';
import layouts from './blockLayouts.json' with { type: 'json' };

export { ALLOWED_SIZES, isAllowedSize, isExactCover, type TemplateRect } from './blockShapes.ts';

const VALUES_PER_RECT = 4;
const VALUES_PER_DELTA = 5;

if (layouts.block[0] !== BLOCK_COLS || layouts.block[1] !== BLOCK_ROWS
  || layouts.slots !== SLOTS_PER_BLOCK || layouts.expanded !== EXPANDED_SIZE) {
  throw new Error('blockLayouts.json was generated for a different block geometry; run `npm run reflows`');
}
if (layouts.templates.length !== TEMPLATE_COUNT || layouts.reflows.length !== TEMPLATE_COUNT) {
  throw new Error(`blockLayouts.json must define ${TEMPLATE_COUNT} templates and reflow tables`);
}

function readTemplate(values: readonly number[], index: number): TemplateRect[] {
  if (values.length !== SLOTS_PER_BLOCK * VALUES_PER_RECT) {
    throw new Error(`Block template ${index} must define ${SLOTS_PER_BLOCK} slots`);
  }
  const rects: TemplateRect[] = [];
  for (let o = 0; o < values.length; o += VALUES_PER_RECT) {
    rects.push({ col: values[o]!, row: values[o + 1]!, w: values[o + 2]!, h: values[o + 3]! });
  }
  return rects;
}

export const BLOCK_TEMPLATES: ReadonlyArray<ReadonlyArray<TemplateRect>> = layouts.templates.map(readTemplate);

/** Block-local layout of template `template` with `slot` expanded: the template plus the stored delta. */
export function reflowRects(template: number, slot: number): TemplateRect[] {
  const base = BLOCK_TEMPLATES[template];
  const delta = layouts.reflows[template]?.[slot];
  if (base === undefined || delta === undefined || delta.length % VALUES_PER_DELTA !== 0) {
    throw new Error(`blockLayouts.json has no reflow for template ${template} slot ${slot}`);
  }
  const rects = base.map((rect) => ({ ...rect }));
  for (let o = 0; o < delta.length; o += VALUES_PER_DELTA) {
    const index = delta[o]!;
    if (!Number.isInteger(index) || index < 0 || index >= SLOTS_PER_BLOCK) {
      throw new Error(`blockLayouts.json has a malformed reflow for template ${template} slot ${slot}`);
    }
    rects[index] = { col: delta[o + 1]!, row: delta[o + 2]!, w: delta[o + 3]!, h: delta[o + 4]! };
  }
  return rects;
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
