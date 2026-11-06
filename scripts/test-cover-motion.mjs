import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ENTRANCE_BLACK_HOLD_MS, ENTRANCE_REVEAL_MS, ENTRANCE_DURATION_MS, sampleCoverMotion } from '../source/panel/wall/coverMotion.ts';

test('entrance places a solid black tile, then quickly removes black without moving or scaling', () => {
  const motion = { kind: 'enter', startedAt: 1000, delayMs: 200 };
  assert.deepEqual(sampleCoverMotion(motion, 1100, false), { opacity: 0, blackOpacity: 1, running: true });
  for (const time of [1200, 1220, 1200 + ENTRANCE_BLACK_HOLD_MS]) {
    assert.deepEqual(sampleCoverMotion(motion, time, false), { opacity: 1, blackOpacity: 1, running: true });
  }
  const middle = sampleCoverMotion(motion, 1200 + ENTRANCE_BLACK_HOLD_MS + ENTRANCE_REVEAL_MS / 2, false);
  assert.equal(middle.opacity, 1, 'the tile itself never crossfades');
  assert.ok(middle.blackOpacity > 0 && middle.blackOpacity < .5, 'ease-out exposes the artwork quickly');
  assert.equal(middle.running, true);
  assert.equal(ENTRANCE_REVEAL_MS, 160);
  assert.deepEqual(sampleCoverMotion(motion, 1200 + ENTRANCE_DURATION_MS, false), { opacity: 1, blackOpacity: 0, running: false });
  assert.deepEqual(sampleCoverMotion(motion, 10_000, false), { opacity: 1, blackOpacity: 0, running: false });
});

test('cards mounted later use the original short fade without moving their edges', () => {
  const motion = { kind: 'fade', startedAt: 1000, delayMs: 0 };
  const middle = sampleCoverMotion(motion, 1060, false);
  assert.ok(middle.opacity > 0 && middle.opacity < 1);
  assert.equal(middle.blackOpacity, 0);
  assert.equal(middle.running, true);
  assert.deepEqual(sampleCoverMotion(motion, 1120, false), { opacity: 1, blackOpacity: 0, running: false });
});

test('reduced motion snaps both animations and normal sampling stays monotonic and bounded', () => {
  for (const kind of ['enter', 'fade']) {
    const motion = { kind, startedAt: 1000, delayMs: 200 };
    assert.deepEqual(sampleCoverMotion(motion, 1000, true), { opacity: 1, blackOpacity: 0, running: false });
    let previous = 0;
    let previousBlack = 1;
    for (let time = 900; time <= 1800; time += 20) {
      const sample = sampleCoverMotion(motion, time, false);
      assert.ok(sample.opacity >= previous && sample.opacity <= 1);
      assert.ok(sample.blackOpacity <= previousBlack && sample.blackOpacity >= 0);
      previous = sample.opacity;
      previousBlack = sample.blackOpacity;
    }
  }
  assert.deepEqual(sampleCoverMotion(null, 1000, false), { opacity: 1, blackOpacity: 0, running: false });
});

test('native CSS and lens shader agree on fast black reveal with no entrance transform', () => {
  const css = readFileSync(new URL('../source/styles/20-poster.css', import.meta.url), 'utf8');
  assert.match(css, /animation: poster-enter-black \.2s both/);
  assert.match(css, /0%, 20% \{ opacity: 1; animation-timing-function: ease-out; \}/);
  assert.doesNotMatch(css, /poster-enter-body|translate3d\(0, 18px/);
  assert.match(css, /\.poster\.poster--enter \.poster__body\{ transform: none; transition: none; \}/);
  assert.equal(ENTRANCE_BLACK_HOLD_MS / ENTRANCE_DURATION_MS, .2);
  const shader = readFileSync(new URL('../source/panel/wall/fisheyeSurface.ts', import.meta.url), 'utf8');
  assert.match(shader, /color \* \(1\.0 - uBlackOpacity\)/);
});
