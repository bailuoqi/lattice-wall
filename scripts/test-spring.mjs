import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRectSpring, stepSpring } from '../source/panel/wall/spring.ts';

const FRAME = 0.016;
const OMEGA = 14;

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected} (±${epsilon})`);
}

test('stepSpring converges monotonically from rest without overshoot and snaps when settled', () => {
  const state = { value: 300, velocity: 0 };
  let steps = 0;
  let previous = state.value;
  let moving = true;
  while (moving) {
    moving = stepSpring(state, 0, FRAME, OMEGA);
    steps += 1;
    assert.ok(steps < 200, 'must settle');
    assert.ok(state.value <= previous, `monotonic approach (${state.value} after ${previous})`);
    assert.ok(state.value > -0.5, `never crosses the target by more than 0.5 px (${state.value})`);
    previous = state.value;
  }
  assert.equal(state.value, 0);
  assert.equal(state.velocity, 0);
  // Closed form: |x| < 0.5 and |v| < 5 are both reached at t ≈ 0.64 s for a 300 px jump at ω = 14.
  const seconds = steps * FRAME;
  assert.ok(seconds >= 0.5 && seconds <= 0.7, `settled after ${seconds.toFixed(3)} s`);
});

test('stepSpring follows the analytical critically damped solution', () => {
  const state = { value: 300, velocity: 0 };
  let t = 0;
  for (let i = 0; i < 20; i += 1) {
    stepSpring(state, 0, FRAME, OMEGA);
    t += FRAME;
    const expected = 300 * (1 + OMEGA * t) * Math.exp(-OMEGA * t);
    near(state.value, expected, 1e-6);
    near(state.velocity, -300 * OMEGA * OMEGA * t * Math.exp(-OMEGA * t), 1e-6);
  }
});

test('stepSpring retargets mid-flight and settles exactly on the new target', () => {
  const state = { value: 0, velocity: 0 };
  for (let i = 0; i < 6; i += 1) stepSpring(state, 300, FRAME, OMEGA);
  assert.ok(state.value > 0 && state.value < 300);
  let steps = 0;
  while (stepSpring(state, 100, FRAME, OMEGA)) {
    steps += 1;
    assert.ok(steps < 200);
  }
  assert.equal(state.value, 100);
  assert.equal(state.velocity, 0);
});

test('stepSpring reports rest immediately when already within the thresholds', () => {
  const state = { value: 10.3, velocity: 1 };
  assert.equal(stepSpring(state, 10, FRAME, OMEGA), false);
  assert.equal(state.value, 10);
  assert.equal(state.velocity, 0);
  assert.equal(stepSpring(state, 10, FRAME, OMEGA), false);
});

test('stepSpring clamps dt to 64 ms and tolerates dt = 0', () => {
  const clamped = { value: 300, velocity: 0 };
  assert.equal(stepSpring(clamped, 0, 10, OMEGA), true);
  near(clamped.value, 300 * (1 + OMEGA * 0.064) * Math.exp(-OMEGA * 0.064), 1e-9);

  const frozen = { value: 300, velocity: -40 };
  assert.equal(stepSpring(frozen, 0, 0, OMEGA), true);
  assert.equal(frozen.value, 300);
  assert.equal(frozen.velocity, -40);
});

test('createRectSpring keeps the identity of current, ignores identical targets and settles on all channels', () => {
  const spring = createRectSpring({ x: 0, y: 0, w: 100, h: 100 });
  const current = spring.current;
  assert.equal(spring.settled, true);
  assert.equal(spring.step(FRAME), false);

  spring.setTarget({ x: 0, y: 0, w: 100, h: 100 });
  assert.equal(spring.settled, true, 'same target is a no-op');
  assert.equal(spring.step(FRAME), false);

  spring.setTarget({ x: 200, y: -50, w: 300, h: 120 });
  assert.equal(spring.settled, false);
  assert.deepEqual(spring.target, { x: 200, y: -50, w: 300, h: 120 });
  assert.deepEqual(spring.current, { x: 0, y: 0, w: 100, h: 100 }, 'setTarget does not move current');

  let steps = 0;
  while (spring.step(FRAME)) {
    steps += 1;
    assert.ok(steps < 200, 'must settle');
    assert.equal(spring.current, current, 'current keeps its identity while moving');
    assert.equal(spring.settled, false);
    assert.ok(current.x >= 0 && current.x <= 200);
    assert.ok(current.y <= 0 && current.y >= -50);
    assert.ok(current.w >= 100 && current.w <= 300);
    assert.ok(current.h >= 100 && current.h <= 120);
  }
  assert.equal(spring.settled, true);
  assert.equal(spring.current, current);
  assert.deepEqual(spring.current, { x: 200, y: -50, w: 300, h: 120 });
  assert.equal(spring.step(FRAME), false);
});

test('createRectSpring.step reports motion while any single channel still moves', () => {
  const spring = createRectSpring({ x: 0, y: 0, w: 100, h: 100 });
  spring.setTarget({ x: 0, y: 0, w: 100, h: 400 });
  assert.equal(spring.step(FRAME), true);
  assert.equal(spring.current.x, 0);
  assert.equal(spring.current.w, 100);
  assert.ok(spring.current.h > 100 && spring.current.h < 400);
  let steps = 1;
  while (spring.step(FRAME)) steps += 1;
  assert.ok(steps > 10, `h needs many frames (${steps})`);
  assert.equal(spring.current.h, 400);
  assert.equal(spring.step(FRAME), false);
});

test('createRectSpring.snap jumps to the target or a given rect with zero velocity', () => {
  const spring = createRectSpring({ x: 0, y: 0, w: 10, h: 10 });
  spring.setTarget({ x: 100, y: 100, w: 10, h: 10 });
  spring.step(FRAME);
  spring.step(FRAME);
  assert.ok(spring.current.x > 0 && spring.current.x < 100);

  spring.snap();
  assert.deepEqual(spring.current, { x: 100, y: 100, w: 10, h: 10 });
  assert.equal(spring.settled, true);
  assert.equal(spring.step(FRAME), false);

  // Build up velocity again, then snap to an explicit rect.
  spring.setTarget({ x: 300, y: 100, w: 10, h: 10 });
  spring.step(FRAME);
  spring.step(FRAME);
  spring.snap({ x: 5, y: 6, w: 7, h: 8 });
  assert.deepEqual(spring.current, { x: 5, y: 6, w: 7, h: 8 });
  assert.deepEqual(spring.target, { x: 5, y: 6, w: 7, h: 8 });
  assert.equal(spring.settled, true);
  // Velocity was zeroed: a sub-threshold nudge settles in one step (a surviving velocity would keep it moving).
  spring.setTarget({ x: 5.2, y: 6, w: 7, h: 8 });
  assert.equal(spring.step(FRAME), false);
  assert.deepEqual(spring.current, { x: 5.2, y: 6, w: 7, h: 8 });
});

test('createRectSpring honours a custom omega', () => {
  const stiff = createRectSpring({ x: 0, y: 0, w: 0, h: 0 }, 40);
  const soft = createRectSpring({ x: 0, y: 0, w: 0, h: 0 }, 8);
  stiff.setTarget({ x: 300, y: 0, w: 0, h: 0 });
  soft.setTarget({ x: 300, y: 0, w: 0, h: 0 });
  let stiffSteps = 0;
  while (stiff.step(FRAME)) stiffSteps += 1;
  let softSteps = 0;
  while (soft.step(FRAME)) softSteps += 1;
  assert.ok(stiffSteps < softSteps, `stiff ${stiffSteps} vs soft ${softSteps}`);
});
