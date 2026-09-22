import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera } from '../source/panel/wall/camera.ts';

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected} (±${epsilon})`);
}

/** Tick from `fromMs` (exclusive) to `toMs` (inclusive) in steps no longer than the camera's 50 ms frame clamp. */
function run(camera, fromMs, toMs, stepMs) {
  let changedFrames = 0;
  for (let t = fromMs + stepMs; t <= toMs + 1e-9; t += stepMs) {
    if (camera.tick(t)) changedFrames += 1;
  }
  return changedFrames;
}

test('bounds() is the visible world rect for centre, viewport and scale', () => {
  const camera = createCamera({ x: 100, y: 50, scale: 2 });
  camera.setViewport(800, 600);
  assert.deepEqual(camera.viewport, { width: 800, height: 600 });
  assert.deepEqual(camera.bounds(), { x: -100, y: -100, w: 400, h: 300 });

  camera.setScale(0.5);
  assert.deepEqual(camera.bounds(), { x: 100 - 800, y: 50 - 600, w: 1600, h: 1200 });
});

test('screenToWorld and worldToScreen invert each other at any scale', () => {
  for (const scale of [1, 0.5, 1.75]) {
    const camera = createCamera({ x: 320.5, y: -140.25, scale });
    camera.setViewport(1280, 720);
    for (const [px, py] of [[0, 0], [640, 360], [1280, 720], [13, 999]]) {
      const world = camera.screenToWorld(px, py);
      const screen = camera.worldToScreen(world.x, world.y);
      near(screen.x, px);
      near(screen.y, py);
    }
    const centre = camera.screenToWorld(640, 360);
    near(centre.x, 320.5);
    near(centre.y, -140.25);
    // One screen px covers 1/scale world px.
    const step = camera.screenToWorld(641, 360);
    near(step.x - centre.x, 1 / scale);
  }
});

function applyTransform(transform, x, y) {
  const match = /^translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) scale\((-?[\d.]+)\)$/.exec(transform);
  assert.ok(match, `unrecognised transform: ${transform}`);
  const tx = Number(match[1]);
  const ty = Number(match[2]);
  const scale = Number(match[3]);
  return { x: tx + x * scale, y: ty + y * scale };
}

test('transform() matches worldToScreen and uses one scale for translate and scale()', () => {
  const camera = createCamera({ x: 100, y: 50, scale: 2 });
  camera.setViewport(800, 600);
  assert.equal(camera.transform(), 'translate3d(200px, 200px, 0) scale(2)');

  camera.setCenter(100.123456, -0.001);
  camera.setScale(1);
  assert.equal(camera.transform(), 'translate3d(299.88px, 300px, 0) scale(1)');
  const origin = camera.worldToScreen(0, 0);
  near(origin.x, 400 - 100.123456);
  near(origin.y, 300 + 0.001);

  camera.setScale(0.333333);
  assert.equal(camera.transform(), 'translate3d(366.63px, 300px, 0) scale(0.3333)');
});

test('transform() keeps the camera centre on the viewport centre while zooming far from the origin', () => {
  const camera = createCamera({ x: 8000, y: -4500, scale: 0.6 });
  camera.setViewport(1280, 720);
  for (const scale of [0.6, 0.603, 0.609, 0.6149, 0.78, 0.333333]) {
    camera.setScale(scale);
    const screen = applyTransform(camera.transform(), 8000, -4500);
    near(screen.x, 640, 0.5);
    near(screen.y, 360, 0.5);
  }
});

test('a zoom-only flight keeps the centre on-screen every frame', () => {
  const camera = createCamera({ x: 7200, y: 5100, scale: 0.78 });
  camera.setViewport(1600, 900);
  camera.flyTo({ x: 7200, y: 5100, scale: 0.6 }, 300);
  camera.tick(0);
  for (let t = 16; t <= 320; t += 16) {
    camera.tick(t);
    const screen = applyTransform(camera.transform(), 7200, 5100);
    near(screen.x, 800, 0.5);
    near(screen.y, 450, 0.5);
  }
  assert.equal(camera.animating, false);
});

test('panBy moves the world with the pointer, divided by scale, and cancels animation', () => {
  const camera = createCamera({ x: 0, y: 0, scale: 2 });
  camera.setViewport(800, 600);
  camera.flyTo({ x: 500, y: 500 }, 400);
  assert.equal(camera.animating, true);

  camera.panBy(20, -10);
  assert.equal(camera.animating, false);
  near(camera.state.x, -10);
  near(camera.state.y, 5);
  // The world point that was under the viewport centre followed the pointer by (20, -10) screen px.
  const moved = camera.worldToScreen(0, 0);
  near(moved.x, 420);
  near(moved.y, 290);
});

test('instant moves are reported by exactly one following tick', () => {
  const camera = createCamera();
  camera.setViewport(800, 600);
  assert.equal(camera.tick(0), false);

  camera.panBy(12, 0);
  assert.equal(camera.tick(16), true);
  assert.equal(camera.tick(32), false);

  camera.setCenter(40, 40);
  camera.setScale(0.8);
  assert.equal(camera.tick(48), true);
  assert.equal(camera.tick(64), false);

  camera.flyTo({ x: 100, y: 100 }, 0);
  assert.equal(camera.tick(80), true);

  camera.panBy(0, 0);
  camera.setCenter(100, 100);
  assert.equal(camera.tick(96), false);
});

test('flyTo eases out (ease-out cubic) and lands exactly on the target', () => {
  const camera = createCamera({ x: 0, y: 0, scale: 1 });
  camera.setViewport(800, 600);
  camera.flyTo({ x: 1000, y: 500, scale: 1.5 }, 400);
  assert.equal(camera.animating, true);
  // The first tick only establishes the time base.
  assert.equal(camera.tick(1000), false);
  assert.equal(camera.state.x, 0);

  assert.equal(run(camera, 1000, 1200, 40), 5);
  const { x, y, scale } = camera.state;
  assert.ok(x > 500 && x < 1000, `at half time x=${x} should be past the linear midpoint`);
  near(x, 875);
  near(y, 437.5);
  near(scale, 1 + 0.5 * 0.875);

  run(camera, 1200, 1400, 40);
  assert.equal(camera.state.x, 1000);
  assert.equal(camera.state.y, 500);
  assert.equal(camera.state.scale, 1.5);
  assert.equal(camera.animating, false);
  assert.equal(camera.tick(1416), false);
});

test('flyTo clamps long frames instead of jumping, and is instant for durationMs <= 0', () => {
  const camera = createCamera();
  camera.setViewport(800, 600);
  camera.flyTo({ x: 1000, y: 0 }, 400);
  camera.tick(0);
  camera.tick(500); // a 500 ms stall counts as a 50 ms frame
  near(camera.state.x, 1000 * (1 - 0.875 ** 3));
  assert.equal(camera.animating, true);

  camera.flyTo({ x: -20, y: 30, scale: 0.5 }, 0);
  assert.equal(camera.animating, false);
  assert.deepEqual({ ...camera.state }, { x: -20, y: 30, scale: 0.5 });
});

test('flyTo keeps the current scale when the target omits it', () => {
  const camera = createCamera({ x: 0, y: 0, scale: 1.25 });
  camera.setViewport(800, 600);
  camera.flyTo({ x: 10, y: 10 }, 100);
  camera.tick(0);
  run(camera, 0, 100, 50);
  assert.equal(camera.state.scale, 1.25);
  assert.equal(camera.state.x, 10);
});

test('fling coasts in the pointer direction, decays exponentially and stops below 5 px/s', () => {
  const camera = createCamera({ x: 0, y: 0, scale: 1 });
  camera.setViewport(800, 600);
  camera.fling(600, 0);
  assert.equal(camera.animating, true);
  assert.equal(camera.tick(0), false);

  let t = 0;
  let previousX = 0;
  let frames = 0;
  let xAtHalfSecond = null;
  while (camera.animating && frames < 1000) {
    t += 16;
    frames += 1;
    assert.equal(camera.tick(t), true);
    // Dragging/flinging to the right carries the world right, i.e. the camera centre moves left.
    assert.ok(camera.state.x < previousX, 'keeps moving in the flung direction');
    previousX = camera.state.x;
    if (t === 496) xAtHalfSecond = camera.state.x;
  }
  assert.equal(camera.animating, false);
  assert.equal(camera.state.y, 0);
  // v(t) = 600·e^(−4.2t): total travel ≈ 600/4.2 ≈ 143 px, rest reached at t ≈ ln(120)/4.2 ≈ 1.14 s.
  assert.ok(camera.state.x < -135 && camera.state.x > -145, `travelled to ${camera.state.x}`);
  assert.ok(t > 1000 && t < 1300, `stopped after ${t} ms`);
  near(xAtHalfSecond, -(600 * (1 - Math.exp(-4.2 * 0.496))) / 4.2, 1e-6);
  assert.equal(camera.tick(t + 16), false);
});

test('fling travel in world px shrinks with zoom (same screen→world conversion as panBy)', () => {
  const zoomed = createCamera({ x: 0, y: 0, scale: 2 });
  zoomed.setViewport(800, 600);
  zoomed.fling(0, -600);
  zoomed.tick(0);
  let t = 0;
  while (zoomed.animating) zoomed.tick((t += 16));
  assert.equal(zoomed.state.x, 0);
  assert.ok(zoomed.state.y > 67 && zoomed.state.y < 73, `travelled to ${zoomed.state.y}`);
});

test('flings slower than 40 px/s are ignored', () => {
  const camera = createCamera({ x: 5, y: 5, scale: 1 });
  camera.fling(20, 20);
  assert.equal(camera.animating, false);
  assert.equal(camera.tick(0), false);
  assert.equal(camera.tick(16), false);
  assert.deepEqual({ ...camera.state }, { x: 5, y: 5, scale: 1 });
});

test('stop() cancels a flight and inertia in place', () => {
  const camera = createCamera();
  camera.setViewport(800, 600);
  camera.flyTo({ x: 1000, y: 0 }, 400);
  camera.tick(0);
  run(camera, 0, 100, 50);
  const midX = camera.state.x;
  assert.ok(midX > 0 && midX < 1000);
  camera.stop();
  assert.equal(camera.animating, false);
  assert.equal(camera.tick(150), false);
  assert.equal(camera.state.x, midX);

  camera.fling(500, 0);
  camera.tick(200);
  camera.tick(216);
  const flungX = camera.state.x;
  camera.stop();
  assert.equal(camera.animating, false);
  assert.equal(camera.tick(232), false);
  assert.equal(camera.state.x, flungX);
});

test('a new fling replaces a flight and a flight replaces inertia', () => {
  const camera = createCamera();
  camera.setViewport(800, 600);
  camera.flyTo({ x: 1000, y: 0 }, 400);
  camera.tick(0);
  camera.tick(50);
  camera.fling(0, 300);
  camera.tick(66);
  camera.tick(82);
  assert.ok(camera.state.y < 0, 'inertia took over');
  const xAfterFlightCancelled = camera.state.x;
  camera.tick(98);
  assert.equal(camera.state.x, xAfterFlightCancelled, 'the flight no longer advances');

  camera.flyTo({ x: 0, y: 0 }, 100);
  camera.tick(114);
  camera.tick(164);
  camera.tick(214);
  assert.equal(camera.state.x, 0);
  assert.equal(camera.state.y, 0);
  assert.equal(camera.animating, false);
});

test('scale is clamped to 0.25..2 everywhere it can be set', () => {
  const camera = createCamera({ scale: 10 });
  assert.equal(camera.state.scale, 2);
  camera.setScale(0.01);
  assert.equal(camera.state.scale, 0.25);
  camera.flyTo({ x: 0, y: 0, scale: 5 }, 0);
  assert.equal(camera.state.scale, 2);
});

test('state and viewport are read-only live views', () => {
  const camera = createCamera({ x: 1, y: 2, scale: 1 });
  const view = camera.state;
  assert.throws(() => {
    view.x = 99;
  }, TypeError);
  camera.setCenter(7, 8);
  assert.equal(view.x, 7);
  assert.equal(view.y, 8);
  assert.throws(() => {
    camera.viewport.width = 1;
  }, TypeError);
});
