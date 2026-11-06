// Block layout solver (SPEC §5). Searches the block templates and the expansion reflows instead of
// hand-drawing them inside a fixed 12×8 box:
//   1. Templates: large-neighbourhood simulated annealing over exact covers of the whole block,
//      scored for looks (no long straight gutters, no "+" crossings, a balanced size mix, heroes
//      kept apart, neighbours of different sizes).
//   2. Reflows: for every template slot, the 6×6 is placed as close to the card's centre as
//      possible and only a local neighbourhood is re-tiled, growing ring by ring when that spreads
//      the squeeze over more cards; displaced cards are assigned with the Hungarian algorithm.
// Deterministic (seeded). Writes source/panel/geometry/blockLayouts.json. Run with `npm run reflows`.

import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { BLOCK_COLS, BLOCK_ROWS, EXPANDED_SIZE, SLOTS_PER_BLOCK, TEMPLATE_COUNT } from '../source/panel/types.ts';
import { ALLOWED_SIZES, isAllowedSize, isExactCover } from '../source/panel/geometry/blockShapes.ts';

const COLS = BLOCK_COLS;
const ROWS = BLOCK_ROWS;
const CELLS = COLS * ROWS;
const MIN_AREA = Math.min(...ALLOWED_SIZES.map(([w, h]) => w * h));
const MAX_AREA = Math.max(...ALLOWED_SIZES.map(([w, h]) => w * h));
const ANNEAL_STEPS = 150000;
const COVER_CAP = 4000;
const outputPath = resolve(import.meta.dirname, '..', 'source', 'panel', 'geometry', 'blockLayouts.json');
const startedAt = performance.now();

if (CELLS !== SLOTS_PER_BLOCK * 8) throw new Error('Expected an average card area of 8 cells');

// --- seeded randomness --------------------------------------------------------------------------

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

function shuffled(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- exact covers of a free-cell mask -----------------------------------------------------------

/**
 * Depth-first exact cover of the cells where `blocked[i] === 0`, using exactly `pieces` allowed
 * rects. Always fills the first free cell in row-major order, so each cover is visited once.
 * `visit(rects)` returns true to stop. Sizes are tried in `options.order(col, row)` order when given,
 * shuffled with `options.random`, or in `ALLOWED_SIZES` order.
 */
function forEachCover(blocked, pieces, visit, options = {}) {
  const grid = Uint8Array.from(blocked);
  let free = 0;
  for (let i = 0; i < CELLS; i++) if (grid[i] === 0) free++;
  const placed = [];
  const random = options.random;
  let budget = options.budget ?? Infinity;
  let stopped = false;

  const fits = (c, r, w, h) => {
    if (c + w > COLS || r + h > ROWS) return false;
    for (let y = r; y < r + h; y++) {
      for (let x = c; x < c + w; x++) if (grid[y * COLS + x]) return false;
    }
    return true;
  };
  const paint = (c, r, w, h, value) => {
    for (let y = r; y < r + h; y++) {
      for (let x = c; x < c + w; x++) grid[y * COLS + x] = value;
    }
  };
  const search = (from, cellsLeft, piecesLeft) => {
    if (stopped || --budget < 0) { stopped = true; return; }
    if (piecesLeft === 0) {
      if (cellsLeft === 0 && visit(placed.map((rect) => ({ ...rect })))) stopped = true;
      return;
    }
    if (cellsLeft < piecesLeft * MIN_AREA || cellsLeft > piecesLeft * MAX_AREA) return;
    let index = from;
    while (grid[index]) index++;
    const c = index % COLS;
    const r = (index - c) / COLS;
    const sizes = options.order ? options.order(c, r) : random ? shuffled(ALLOWED_SIZES, random) : ALLOWED_SIZES;
    for (const [w, h] of sizes) {
      if (!fits(c, r, w, h)) continue;
      paint(c, r, w, h, 1);
      placed.push({ col: c, row: r, w, h });
      search(index + 1, cellsLeft - w * h, piecesLeft - 1);
      placed.pop();
      paint(c, r, w, h, 0);
      if (stopped) return;
    }
  };
  search(0, free, pieces);
}

/** One random exact cover of the free cells with exactly `pieces` rects, or null. */
function randomCover(blocked, pieces, random, budget = 20000) {
  let found = null;
  forEachCover(blocked, pieces, (rects) => { found = rects; return true; }, { random, budget });
  return found;
}

// --- aesthetic score (lower is better) ------------------------------------------------------------

/** Target card counts per area class for one block (sums to SLOTS_PER_BLOCK cards, CELLS cells). */
const MIX_TARGET = new Map([[4, 11], [6, 7], [8, 4], [12, 4], [16, 2], [18, 1], [24, 1]]);
{
  const cards = [...MIX_TARGET.values()].reduce((sum, count) => sum + count, 0);
  const area = [...MIX_TARGET].reduce((sum, [cells, count]) => sum + cells * count, 0);
  if (cards !== SLOTS_PER_BLOCK || area !== CELLS) throw new Error(`MIX_TARGET must describe ${SLOTS_PER_BLOCK} cards over ${CELLS} cells`);
}
const HERO_AREA = 16;
const W = {
  seam: 1, // per (run − 6)² of a straight gutter running past one card edge
  cross: 4, // four cards meeting at one point ("+" instead of "T")
  same: 2, // neighbours with the identical size read as a repeated grid
  heroTouch: 6, // two heroes sharing an edge
  heroNear: 0.4, // per (9 − centre distance)² between heroes
  mix: 1.5, // per squared deviation from MIX_TARGET
  orient: 0.5, // per squared portrait / landscape imbalance
};

function ownerGrid(layout) {
  const owner = new Int16Array(CELLS).fill(-1);
  layout.forEach(({ col, row, w, h }, index) => {
    for (let y = row; y < row + h; y++) {
      for (let x = col; x < col + w; x++) owner[y * COLS + x] = index;
    }
  });
  return owner;
}

function scoreLayout(layout) {
  const owner = ownerGrid(layout);
  let score = 0;
  const runPenalty = (length) => (length > 6 ? (length - 6) ** 2 : 0);
  // Straight gutters: maximal runs of consecutive edge cells along each interior line.
  for (let y = 1; y < ROWS; y++) {
    let run = 0;
    for (let x = 0; x <= COLS; x++) {
      const edge = x < COLS && owner[(y - 1) * COLS + x] !== owner[y * COLS + x];
      if (edge) run++;
      else { score += W.seam * runPenalty(run); run = 0; }
    }
  }
  for (let x = 1; x < COLS; x++) {
    let run = 0;
    for (let y = 0; y <= ROWS; y++) {
      const edge = y < ROWS && owner[y * COLS + x - 1] !== owner[y * COLS + x];
      if (edge) run++;
      else { score += W.seam * runPenalty(run); run = 0; }
    }
  }
  // "+" junctions.
  for (let y = 1; y < ROWS; y++) {
    for (let x = 1; x < COLS; x++) {
      const a = owner[(y - 1) * COLS + x - 1];
      const b = owner[(y - 1) * COLS + x];
      const c = owner[y * COLS + x - 1];
      const d = owner[y * COLS + x];
      if (a !== b && c !== d && a !== c && b !== d) score += W.cross;
    }
  }
  // Neighbour pairs (each counted once).
  const seen = new Set();
  const visitPair = (i, j) => {
    if (i === j) return;
    const key = i < j ? i * 64 + j : j * 64 + i;
    if (seen.has(key)) return;
    seen.add(key);
    const p = layout[i];
    const q = layout[j];
    if (p.w === q.w && p.h === q.h) score += W.same;
    if (p.w * p.h >= HERO_AREA && q.w * q.h >= HERO_AREA) score += W.heroTouch;
  };
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const here = owner[y * COLS + x];
      if (x + 1 < COLS) visitPair(here, owner[y * COLS + x + 1]);
      if (y + 1 < ROWS) visitPair(here, owner[(y + 1) * COLS + x]);
    }
  }
  // Size mix, orientation balance and hero spacing.
  const counts = new Map();
  let portrait = 0;
  let landscape = 0;
  const heroes = [];
  for (const rect of layout) {
    const area = rect.w * rect.h;
    counts.set(area, (counts.get(area) ?? 0) + 1);
    if (rect.h > rect.w) portrait++;
    else if (rect.w > rect.h) landscape++;
    if (area >= HERO_AREA) heroes.push([rect.col + rect.w / 2, rect.row + rect.h / 2]);
  }
  for (const [area, target] of MIX_TARGET) score += W.mix * ((counts.get(area) ?? 0) - target) ** 2;
  score += W.orient * (portrait - landscape) ** 2;
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const distance = Math.hypot(heroes[i][0] - heroes[j][0], heroes[i][1] - heroes[j][1]);
      if (distance < 9) score += W.heroNear * (9 - distance) ** 2;
    }
  }
  return score;
}

// --- template search ------------------------------------------------------------------------------

function byReadingOrder(a, b) {
  return a.row - b.row || a.col - b.col;
}

/** Large-neighbourhood annealing: free the cards inside a random window, re-tile them, keep or undo. */
function searchTemplate(seed) {
  const random = mulberry32(seed);
  let layout = null;
  while (layout === null) layout = randomCover(new Uint8Array(CELLS), SLOTS_PER_BLOCK, random, 400000);
  let score = scoreLayout(layout);
  let best = layout;
  let bestScore = score;
  const hot = 6;
  const cold = 0.03;
  for (let step = 0; step < ANNEAL_STEPS; step++) {
    const temperature = hot * (cold / hot) ** (step / ANNEAL_STEPS);
    const ww = 4 + Math.floor(random() * 7);
    const wh = 4 + Math.floor(random() * 6);
    const x0 = Math.floor(random() * (COLS - ww + 1));
    const y0 = Math.floor(random() * (ROWS - wh + 1));
    const inside = [];
    const keep = [];
    for (const rect of layout) {
      const contained = rect.col >= x0 && rect.row >= y0 && rect.col + rect.w <= x0 + ww && rect.row + rect.h <= y0 + wh;
      (contained ? inside : keep).push(rect);
    }
    if (inside.length < 2) continue;
    const blocked = new Uint8Array(CELLS).fill(1);
    for (const { col, row, w, h } of inside) {
      for (let y = row; y < row + h; y++) {
        for (let x = col; x < col + w; x++) blocked[y * COLS + x] = 0;
      }
    }
    const replacement = randomCover(blocked, inside.length, random, 4000);
    if (replacement === null) continue;
    const candidate = keep.concat(replacement);
    const candidateScore = scoreLayout(candidate);
    if (candidateScore <= score || random() < Math.exp((score - candidateScore) / temperature)) {
      layout = candidate;
      score = candidateScore;
      if (score < bestScore) {
        best = layout;
        bestScore = score;
      }
    }
  }
  return { layout: best.slice().sort(byReadingOrder), score: bestScore };
}

// --- reflows --------------------------------------------------------------------------------------

const LAMBDA = 0.35; // area change, per cell, in the assignment cost
const MOVE_COST = 0.6; // per displaced card, so untouched neighbours stay put
const SHIFT_COST = 2.5; // per cell between the 6×6 centre and the card's own centre
const SHIFT_EXCESS = 8; // per squared cell beyond the nearest feasible 6×6, so a card grows in place
const LOOK_COST = 0.5; // weight of the block score change, judged for every candidate cover
const MAX_RINGS = 2;
const CANDIDATE_LIMIT = 10;
const REFLOW_COVER_CAP = 600; // covers in the near-original pass
// Short passes in seeded random size order: DFS backtracking only varies the last pieces of a cover,
// so several short random starts reach more distinct layouts than one long pass.
const RANDOM_PASSES = 6;
const RANDOM_PASS_CAP = 120;

/** Minimum-cost perfect assignment (Kuhn–Munkres with potentials), O(n³). */
function hungarian(cost, n) {
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const current = cost[(i0 - 1) * n + j - 1] - u[i0] - v[j];
        if (current < minv[j]) { minv[j] = current; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const assignment = new Int32Array(n);
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  let total = 0;
  for (let i = 0; i < n; i++) total += cost[i * n + assignment[i]];
  return { assignment, total };
}

const overlaps = (a, b) => a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
const touches = (a, b) =>
  (a.col + a.w === b.col || b.col + b.w === a.col) && a.row < b.row + b.h && b.row < a.row + a.h
  || (a.row + a.h === b.row || b.row + b.h === a.row) && a.col < b.col + b.w && b.col < a.col + a.w;

/** Re-tile the cells of `affected` cards around a 6×6 at `box`; null when no cover exists. */
function retile(template, owner, slot, box, affected, baseScore) {
  const blocked = new Uint8Array(CELLS).fill(1);
  for (const index of affected) {
    const { col, row, w, h } = template[index];
    for (let y = row; y < row + h; y++) {
      for (let x = col; x < col + w; x++) blocked[y * COLS + x] = 0;
    }
  }
  for (let y = box.row; y < box.row + EXPANDED_SIZE; y++) {
    for (let x = box.col; x < box.col + EXPANDED_SIZE; x++) blocked[y * COLS + x] = 1;
  }
  const displaced = [...affected].filter((index) => index !== slot).sort((a, b) => a - b);
  const k = displaced.length;
  if (k === 0) return null;
  // Try shapes close to the card that used to cover a cell first, so early covers resemble the original.
  const order = (c, r) => {
    const before = template[owner[r * COLS + c]];
    const area = before.w * before.h;
    return ALLOWED_SIZES.slice().sort((a, b) =>
      Math.abs(a[0] * a[1] - area) + 0.1 * (Math.abs(a[0] - before.w) + Math.abs(a[1] - before.h))
      - Math.abs(b[0] * b[1] - area) - 0.1 * (Math.abs(b[0] - before.w) + Math.abs(b[1] - before.h)));
  };
  const cost = new Float64Array(k * k);
  const fixed = SHIFT_COST * box.distance + SHIFT_EXCESS * box.excess ** 2;
  let best = null;
  let visited = 0;
  let cap = REFLOW_COVER_CAP;
  const visit = (cover) => {
    let bound = 0;
    for (let i = 0; i < k; i++) {
      const from = template[displaced[i]];
      const fx = from.col + from.w / 2;
      const fy = from.row + from.h / 2;
      let cheapest = Infinity;
      for (let j = 0; j < k; j++) {
        const to = cover[j];
        const value = Math.hypot(to.col + to.w / 2 - fx, to.row + to.h / 2 - fy) + LAMBDA * Math.abs(to.w * to.h - from.w * from.h);
        cost[i * k + j] = value;
        if (value < cheapest) cheapest = value;
      }
      bound += cheapest;
    }
    // Scores are never negative, so a cover can improve the looks by at most `baseScore`.
    if (best === null || bound + fixed - LOOK_COST * baseScore < best.cost) {
      const { assignment, total } = hungarian(cost, k);
      const layout = template.map((rect) => ({ ...rect }));
      layout[slot] = { col: box.col, row: box.row, w: EXPANDED_SIZE, h: EXPANDED_SIZE };
      let moved = 0;
      displaced.forEach((index, i) => {
        const next = cover[assignment[i]];
        const before = template[index];
        if (next.col !== before.col || next.row !== before.row || next.w !== before.w || next.h !== before.h) moved++;
        layout[index] = { ...next };
      });
      const combined = total + MOVE_COST * moved + fixed + LOOK_COST * (scoreLayout(layout) - baseScore);
      if (best === null || combined < best.cost) best = { layout, cost: combined, moved, box };
    }
    return ++visited >= cap;
  };
  forEachCover(blocked, k, visit, { order, budget: 400000 });
  const random = mulberry32(slot * 7919 + box.row * 131 + box.col * 17 + affected.size);
  cap = RANDOM_PASS_CAP;
  for (let pass = 0; pass < RANDOM_PASSES; pass++) {
    visited = 0;
    forEachCover(blocked, k, visit, { random, budget: 200000 });
  }
  return best;
}

function solveReflow(template, slot, baseScore) {
  const owner = ownerGrid(template);
  const target = template[slot];
  const tx = target.col + target.w / 2;
  const ty = target.row + target.h / 2;
  const boxes = [];
  for (let row = 0; row + EXPANDED_SIZE <= ROWS; row++) {
    for (let col = 0; col + EXPANDED_SIZE <= COLS; col++) {
      boxes.push({ col, row, w: EXPANDED_SIZE, h: EXPANDED_SIZE, distance: Math.hypot(col + EXPANDED_SIZE / 2 - tx, row + EXPANDED_SIZE / 2 - ty) });
    }
  }
  boxes.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
  for (const box of boxes) box.excess = box.distance - boxes[0].distance;
  // The 6×6 always covers part of the card that was clicked, so it visibly grows out of it.
  const growing = boxes.filter((box) => overlaps(box, target));
  let best = null;
  for (const box of growing.slice(0, CANDIDATE_LIMIT)) {
    const affected = new Set([slot]);
    template.forEach((rect, index) => { if (overlaps(rect, box)) affected.add(index); });
    for (let ring = 0; ring <= MAX_RINGS; ring++) {
      if (ring > 0) {
        const grown = [...affected];
        template.forEach((rect, index) => {
          if (!affected.has(index) && grown.some((other) => touches(rect, template[other]))) affected.add(index);
        });
      }
      const result = retile(template, owner, slot, box, affected, baseScore);
      if (result !== null && (best === null || result.cost < best.cost)) best = result;
    }
  }
  return best;
}

// --- driver: one worker per template (template search + its reflows) ------------------------------

const TEMPLATE_SEEDS = [11, 23, 37, 51, 73];

function validate(layout, label, expandedSlot = -1) {
  if (layout.length !== SLOTS_PER_BLOCK) throw new Error(`${label}: ${layout.length} rects`);
  if (!isExactCover(layout)) throw new Error(`${label}: not an exact cover`);
  layout.forEach((rect, index) => {
    if (index === expandedSlot) {
      if (rect.w !== EXPANDED_SIZE || rect.h !== EXPANDED_SIZE) throw new Error(`${label}: expanded slot is not 6×6`);
    } else if (!isAllowedSize(rect.w, rect.h)) {
      throw new Error(`${label}: slot ${index} is ${rect.w}×${rect.h}`);
    }
  });
}

function solveTemplate(t) {
  const { layout, score } = searchTemplate(TEMPLATE_SEEDS[t]);
  const table = [];
  let moved = 0;
  let shift = 0;
  for (let s = 0; s < SLOTS_PER_BLOCK; s++) {
    const solved = solveReflow(layout, s, score);
    if (solved === null) throw new Error(`No reflow for template ${t} slot ${s}`);
    table.push(solved.layout);
    moved += solved.moved;
    shift += solved.box.distance;
  }
  return { layout, score, table, moved, shift };
}

if (!isMainThread) {
  parentPort.postMessage(solveTemplate(workerData.template));
  process.exit(0);
}

const solvedTemplates = await Promise.all(Array.from({ length: TEMPLATE_COUNT }, (_, t) => new Promise((done, fail) => {
  const worker = new Worker(new URL(import.meta.url), { workerData: { template: t } });
  worker.once('message', (result) => {
    console.log(`template ${t}: score ${result.score.toFixed(1)}, reflows solved`);
    done(result);
  });
  worker.once('error', fail);
  worker.once('exit', (code) => { if (code !== 0) fail(new Error(`template ${t} worker exited with ${code}`)); });
})));

const templates = [];
const reflows = [];
let movedTotal = 0;
let shiftTotal = 0;
solvedTemplates.forEach(({ layout: template, table, moved, shift }, t) => {
  validate(template, `template ${t}`);
  templates.push({ layout: template });
  reflows.push(table.map((layout, s) => {
    validate(layout, `template ${t} slot ${s}`, s);
    const delta = [];
    layout.forEach((rect, index) => {
      const before = template[index];
      if (rect.col !== before.col || rect.row !== before.row || rect.w !== before.w || rect.h !== before.h) {
        delta.push(index, rect.col, rect.row, rect.w, rect.h);
      }
    });
    return delta;
  }));
  movedTotal += moved;
  shiftTotal += shift;
});

const flat = (layout) => layout.flatMap(({ col, row, w, h }) => [col, row, w, h]);
const lines = [
  '{',
  '  "version": 2,',
  `  "block": [${COLS}, ${ROWS}],`,
  `  "slots": ${SLOTS_PER_BLOCK},`,
  `  "expanded": ${EXPANDED_SIZE},`,
  '  "templates": [',
  ...templates.map(({ layout }, t) => `    ${JSON.stringify(flat(layout))}${t < templates.length - 1 ? ',' : ''}`),
  '  ],',
  '  "reflows": [',
];
reflows.forEach((table, t) => {
  lines.push('    [');
  table.forEach((delta, s) => lines.push(`      ${JSON.stringify(delta)}${s < table.length - 1 ? ',' : ''}`));
  lines.push(`    ]${t < reflows.length - 1 ? ',' : ''}`);
});
lines.push('  ]', '}', '');
const json = lines.join('\n');
JSON.parse(json);
writeFileSync(outputPath, json, 'utf8');

const count = TEMPLATE_COUNT * SLOTS_PER_BLOCK;
console.log(`\nWrote ${outputPath} (${statSync(outputPath).size} bytes)`);
console.log(`${count} reflows: ${(movedTotal / count).toFixed(1)} cards moved and ${(shiftTotal / count).toFixed(2)} cells of 6×6 shift on average`);
console.log(`${(performance.now() - startedAt).toFixed(0)} ms`);
