// Reflow-table solver (SPEC §5). For every template and every slot it places the expanded 6×6 card
// as close as possible to the original slot, tiles the remaining 60 cells with exactly 11 allowed
// rects, and assigns the displaced cards to those rects with minimum movement + area change. Writes
// source/panel/geometry/blockReflows.json. Run with `npm run reflows`.

import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BLOCK_COLS, BLOCK_ROWS, EXPANDED_SIZE, SLOTS_PER_BLOCK, TEMPLATE_COUNT } from '../source/panel/types.ts';
import { ALLOWED_SIZES, BLOCK_TEMPLATES, isAllowedSize, isExactCover } from '../source/panel/geometry/blockTemplates.ts';

const LAMBDA = 0.35;
const COVER_CAP = 20000;
const CELLS = BLOCK_COLS * BLOCK_ROWS;
const DISPLACED = SLOTS_PER_BLOCK - 1;
const FULL_MASK = (1 << DISPLACED) - 1;
const MIN_AREA = Math.min(...ALLOWED_SIZES.map(([w, h]) => w * h));
const MAX_AREA = Math.max(...ALLOWED_SIZES.map(([w, h]) => w * h));
const outputPath = resolve(import.meta.dirname, '..', 'source', 'panel', 'geometry', 'blockReflows.json');

const startedAt = performance.now();

// --- exact covers of the 60 cells left by a 6×6 at (col, row), memoised per position -----------

const coverCache = new Map();

function coversFor(col, row) {
  const key = `${col},${row}`;
  const cached = coverCache.get(key);
  if (cached) return cached;

  const grid = new Uint8Array(CELLS);
  for (let r = row; r < row + EXPANDED_SIZE; r++) {
    for (let c = col; c < col + EXPANDED_SIZE; c++) grid[r * BLOCK_COLS + c] = 1;
  }
  const covers = [];
  const placed = new Int8Array(DISPLACED * 4);
  let truncated = false;

  const fits = (c, r, w, h) => {
    if (c + w > BLOCK_COLS || r + h > BLOCK_ROWS) return false;
    for (let y = r; y < r + h; y++) {
      for (let x = c; x < c + w; x++) if (grid[y * BLOCK_COLS + x]) return false;
    }
    return true;
  };
  const paint = (c, r, w, h, value) => {
    for (let y = r; y < r + h; y++) {
      for (let x = c; x < c + w; x++) grid[y * BLOCK_COLS + x] = value;
    }
  };

  // Always fills the first empty cell in row-major order, so every cover is enumerated exactly once.
  const search = (from, cellsLeft, piecesLeft) => {
    if (covers.length >= COVER_CAP) {
      truncated = true;
      return;
    }
    if (piecesLeft === 0) {
      if (cellsLeft === 0) covers.push(placed.slice());
      return;
    }
    if (cellsLeft < piecesLeft * MIN_AREA || cellsLeft > piecesLeft * MAX_AREA) return;
    let index = from;
    while (grid[index]) index++;
    const c = index % BLOCK_COLS;
    const r = (index - c) / BLOCK_COLS;
    const depth = (DISPLACED - piecesLeft) * 4;
    for (const [w, h] of ALLOWED_SIZES) {
      if (!fits(c, r, w, h)) continue;
      paint(c, r, w, h, 1);
      placed[depth] = c;
      placed[depth + 1] = r;
      placed[depth + 2] = w;
      placed[depth + 3] = h;
      search(index + 1, cellsLeft - w * h, piecesLeft - 1);
      paint(c, r, w, h, 0);
    }
  };
  search(0, CELLS - EXPANDED_SIZE * EXPANDED_SIZE, DISPLACED);

  const result = { covers, truncated };
  coverCache.set(key, result);
  return result;
}

// --- minimum-cost assignment of 11 displaced cards to 11 rects (bitmask DP) ---------------------

const POPCOUNT = new Uint8Array(FULL_MASK + 1);
for (let mask = 1; mask <= FULL_MASK; mask++) POPCOUNT[mask] = POPCOUNT[mask >> 1] + (mask & 1);
const dp = new Float64Array(FULL_MASK + 1);
const choice = new Int8Array(FULL_MASK + 1);
const cost = new Float64Array(DISPLACED * DISPLACED);

function centre(rect) {
  return [rect.col + rect.w / 2, rect.row + rect.h / 2];
}

/** Returns the best total cost, or Infinity when the lower bound already exceeds `bound`. */
function assign(displaced, cover, bound) {
  let lowerBound = 0;
  for (let i = 0; i < DISPLACED; i++) {
    const [cx, cy] = centre(displaced[i]);
    const area = displaced[i].w * displaced[i].h;
    let cheapest = Infinity;
    for (let j = 0; j < DISPLACED; j++) {
      const o = j * 4;
      const dx = cover[o] + cover[o + 2] / 2 - cx;
      const dy = cover[o + 1] + cover[o + 3] / 2 - cy;
      const value = Math.hypot(dx, dy) + LAMBDA * Math.abs(cover[o + 2] * cover[o + 3] - area);
      cost[i * DISPLACED + j] = value;
      if (value < cheapest) cheapest = value;
    }
    lowerBound += cheapest;
  }
  if (lowerBound >= bound) return { total: Infinity, mapping: null };

  dp[0] = 0;
  for (let mask = 1; mask <= FULL_MASK; mask++) {
    const i = POPCOUNT[mask] - 1;
    let best = Infinity;
    let bestJ = -1;
    for (let j = 0; j < DISPLACED; j++) {
      if ((mask & (1 << j)) === 0) continue;
      const value = dp[mask ^ (1 << j)] + cost[i * DISPLACED + j];
      if (value < best) {
        best = value;
        bestJ = j;
      }
    }
    dp[mask] = best;
    choice[mask] = bestJ;
  }
  const mapping = new Int8Array(DISPLACED);
  let mask = FULL_MASK;
  for (let i = DISPLACED - 1; i >= 0; i--) {
    const j = choice[mask];
    mapping[i] = j;
    mask ^= 1 << j;
  }
  return { total: dp[FULL_MASK], mapping };
}

// --- per (template, slot) search over distance-ordered 6×6 candidates ---------------------------

const CANDIDATES = [];
for (let row = 0; row + EXPANDED_SIZE <= BLOCK_ROWS; row++) {
  for (let col = 0; col + EXPANDED_SIZE <= BLOCK_COLS; col++) CANDIDATES.push({ col, row });
}

function solveSlot(template, slot) {
  const target = template[slot];
  const [tx, ty] = centre(target);
  const ordered = CANDIDATES.map((candidate) => ({
    ...candidate,
    distance: Math.hypot(candidate.col + EXPANDED_SIZE / 2 - tx, candidate.row + EXPANDED_SIZE / 2 - ty),
  })).sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
  const displaced = template.filter((_, index) => index !== slot);

  for (let rank = 0; rank < ordered.length; rank++) {
    const candidate = ordered[rank];
    const { covers, truncated } = coversFor(candidate.col, candidate.row);
    if (covers.length === 0) continue;

    let bestTotal = Infinity;
    let bestMapping = null;
    let bestCover = null;
    for (const cover of covers) {
      const { total, mapping } = assign(displaced, cover, bestTotal);
      if (total < bestTotal) {
        bestTotal = total;
        bestMapping = mapping;
        bestCover = cover;
      }
    }

    const layout = new Array(SLOTS_PER_BLOCK);
    layout[slot] = [candidate.col, candidate.row, EXPANDED_SIZE, EXPANDED_SIZE];
    for (let i = 0; i < DISPLACED; i++) {
      const o = bestMapping[i] * 4;
      layout[i < slot ? i : i + 1] = [bestCover[o], bestCover[o + 1], bestCover[o + 2], bestCover[o + 3]];
    }
    return { layout, candidate, rank, coverCount: covers.length, truncated, cost: bestTotal };
  }
  return null;
}

function validateLayout(layout, slot) {
  const rects = layout.map(([col, row, w, h]) => ({ col, row, w, h }));
  if (rects.length !== SLOTS_PER_BLOCK) return 'wrong rect count';
  if (!isExactCover(rects)) return 'not an exact cover';
  if (rects[slot].w !== EXPANDED_SIZE || rects[slot].h !== EXPANDED_SIZE) return 'expanded slot is not 6×6';
  if (!rects.every((rect, index) => index === slot || isAllowedSize(rect.w, rect.h))) return 'disallowed size';
  return null;
}

const tables = [];
const failures = [];
let totalCost = 0;
for (let t = 0; t < TEMPLATE_COUNT; t++) {
  const template = BLOCK_TEMPLATES[t];
  const table = [];
  for (let s = 0; s < SLOTS_PER_BLOCK; s++) {
    const solved = solveSlot(template, s);
    if (!solved) {
      failures.push(`template ${t} slot ${s}`);
      continue;
    }
    const problem = validateLayout(solved.layout, s);
    if (problem) throw new Error(`Solver produced an invalid layout for template ${t} slot ${s}: ${problem}`);
    table.push(solved.layout);
    totalCost += solved.cost;
    const { col, row } = solved.candidate;
    console.log(
      `template ${t} slot ${String(s).padStart(2)}: 6×6 at (${col},${row}) candidate #${solved.rank + 1}` +
        ` covers=${solved.coverCount}${solved.truncated ? '+' : ''} cost=${solved.cost.toFixed(2)}`,
    );
  }
  tables.push(table);
}
if (failures.length > 0) {
  throw new Error(`No exact reflow exists for: ${failures.join('; ')}. Adjust the affected template(s).`);
}

console.log('\nCover counts per 6×6 position (col,row → covers):');
const coverSummary = [...coverCache.entries()]
  .map(([key, { covers, truncated }]) => `${key}→${covers.length}${truncated ? '+' : ''}`)
  .join('  ');
console.log(`  ${coverSummary}`);

const lines = ['{', '  "version": 1,', `  "block": [${BLOCK_COLS}, ${BLOCK_ROWS}],`, `  "expanded": ${EXPANDED_SIZE},`, `  "lambda": ${LAMBDA},`, '  "tables": ['];
tables.forEach((table, t) => {
  lines.push('    [');
  table.forEach((layout, s) => {
    lines.push(`      ${JSON.stringify(layout)}${s < table.length - 1 ? ',' : ''}`);
  });
  lines.push(`    ]${t < tables.length - 1 ? ',' : ''}`);
});
lines.push('  ]', '}', '');
const json = lines.join('\n');
JSON.parse(json);
writeFileSync(outputPath, json, 'utf8');

const elapsed = performance.now() - startedAt;
const bytes = statSync(outputPath).size;
console.log(`\nWrote ${outputPath}`);
console.log(`${TEMPLATE_COUNT * SLOTS_PER_BLOCK} layouts, total cost ${totalCost.toFixed(2)}, ${bytes} bytes, ${elapsed.toFixed(0)} ms`);
