import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleCoverMotion } from '../source/panel/wall/coverMotion.ts';

test('entrance waits for its stagger delay, moves and fades, then stops requesting frames', () => {
  const motion = { kind: 'enter', startedAt: 1000, delayMs: 200 };
  assert.deepEqual(sampleCoverMotion(motion, 1100, false), { opacity: 0, offsetY: 18, running: true });
  const middle = sampleCoverMotion(motion, 1350, false);
  assert.ok(middle.opacity > 0 && middle.opacity < 1);
  assert.ok(middle.offsetY > 0 && middle.offsetY < 18);
  assert.equal(middle.running, true);
  assert.deepEqual(sampleCoverMotion(motion, 1650, false), { opacity: 1, offsetY: 0, running: false });
  assert.deepEqual(sampleCoverMotion(motion, 10_000, false), { opacity: 1, offsetY: 0, running: false });
});

test('cards mounted later use the original short fade without moving their edges', () => {
  const motion = { kind: 'fade', startedAt: 1000, delayMs: 0 };
  const middle = sampleCoverMotion(motion, 1060, false);
  assert.ok(middle.opacity > 0 && middle.opacity < 1);
  assert.equal(middle.offsetY, 0);
  assert.equal(middle.running, true);
  assert.deepEqual(sampleCoverMotion(motion, 1120, false), { opacity: 1, offsetY: 0, running: false });
});

test('reduced motion snaps both animations and normal sampling stays monotonic and bounded', () => {
  for (const kind of ['enter', 'fade']) {
    const motion = { kind, startedAt: 1000, delayMs: 200 };
    assert.deepEqual(sampleCoverMotion(motion, 1000, true), { opacity: 1, offsetY: 0, running: false });
    let previous = 0;
    for (let time = 900; time <= 1800; time += 20) {
      const sample = sampleCoverMotion(motion, time, false);
      assert.ok(sample.opacity >= previous && sample.opacity <= 1);
      assert.ok(sample.offsetY >= 0 && sample.offsetY <= 18);
      previous = sample.opacity;
    }
  }
  assert.deepEqual(sampleCoverMotion(null, 1000, false), { opacity: 1, offsetY: 0, running: false });
});
