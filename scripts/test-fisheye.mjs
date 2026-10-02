import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCamera } from '../source/panel/wall/camera.ts';
import { fisheyeOffset, fisheyeCardMatrix, fisheyeChildMatrix } from '../source/panel/wall/fisheye.ts';
import { applyRect, syncPosterProjection } from '../source/panel/wall/poster.ts';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('the lens fixes the centre and axis edges, and bends all four corners inward', () => {
  assert.deepEqual(fisheyeOffset(0, 0, 800, 450), { x: 0, y: 0 });
  near(fisheyeOffset(800, 0, 800, 450).x, 800);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const point = fisheyeOffset(sx * 800, sy * 450, 800, 450);
    assert.ok(Math.abs(point.x) < 800 && Math.abs(point.y) < 450);
    assert.equal(Math.sign(point.x), sx);
    assert.equal(Math.sign(point.y), sy);
  }
});

test('lens switching eases over 240 ms, can reverse and can finish instantly for reduced motion', () => {
  const camera = createCamera();
  camera.setViewport(1600, 900);
  camera.setFisheye(true, true);
  camera.tick(0); camera.tick(40); camera.tick(80);
  assert.ok(camera.fisheyeAmount > 0 && camera.fisheyeAmount < 1);
  const before = camera.fisheyeAmount;
  camera.setFisheye(false, true);
  camera.tick(80); camera.tick(120); camera.tick(160);
  assert.ok(camera.fisheyeAmount < before);
  camera.setFisheye(true, false);
  assert.equal(camera.fisheyeAmount, 1);
  assert.equal(camera.animating, false);
  camera.setFisheye(false, true);
  for (let time = 200; time <= 480; time += 40) camera.tick(time);
  assert.equal(camera.fisheyeAmount, 0);
  assert.equal(camera.fisheye, false);
});

test('intermediate lens strengths preserve source/screen correspondence', () => {
  for (const amount of [0, .1, .5, .9, 1]) for (const [x, y] of [[0, 0], [600, -300], [-1000, 700]]) {
    const point = fisheyeOffset(x, y, 800, 450, false, amount);
    const inverse = fisheyeOffset(point.x, point.y, 800, 450, true, amount);
    near(inverse.x, x); near(inverse.y, y);
  }
});

test('screen/world conversion stays invertible across sizes, zooms and long pans', () => {
  for (const [width, height] of [[375, 812], [1600, 900], [3840, 2160]]) {
    const camera = createCamera({ x: 1e7, y: -1e7, scale: 0.6 });
    camera.setViewport(width, height);
    camera.setFisheye(true);
    const bounds = camera.bounds();
    for (let col = 0; col <= 8; col++) for (let row = 0; row <= 8; row++) {
      const x = width * col / 8, y = height * row / 8;
      const world = camera.screenToWorld(x, y);
      const screen = camera.worldToScreen(world.x, world.y);
      near(screen.x, x, 1e-5); near(screen.y, y, 1e-5);
      assert.ok(world.x >= bounds.x - 1e-6 && world.x <= bounds.x + bounds.w + 1e-6);
      assert.ok(world.y >= bounds.y - 1e-6 && world.y <= bounds.y + bounds.h + 1e-6);
    }
    camera.setFisheye(false);
    assert.equal(camera.bounds().w, width / camera.state.scale);
  }
});

test('the CSS matrix places every card corner at its projected position', () => {
  for (const centre of [{ x: 0, y: 0 }, { x: 1e7, y: -1e7 }]) {
    const camera = createCamera({ ...centre, scale: 0.78 });
    camera.setViewport(1600, 900);
    camera.setFisheye(true);
    for (const offset of [-900, -100, 600]) {
      const rect = { x: centre.x + offset, y: centre.y - 300, w: 530, h: 260 };
      const matrix = camera.cardTransform(rect).match(/matrix3d\(([^)]+)\)/)[1].split(',').map(Number);
      assert.ok(matrix.every(Number.isFinite));
      for (const [x, y] of [[0, 0], [rect.w, 0], [rect.w, rect.h], [0, rect.h]]) {
        const divisor = matrix[3] * x + matrix[7] * y + matrix[15];
        assert.ok(divisor > 0);
        const actualX = rect.x + (matrix[0] * x + matrix[4] * y + matrix[12]) / divisor;
        const actualY = rect.y + (matrix[1] * x + matrix[5] * y + matrix[13]) / divisor;
        const expected = camera.worldToScreen(rect.x + x, rect.y + y);
        near((actualX - centre.x) * camera.state.scale + 800, expected.x, .001);
        near((actualY - centre.y) * camera.state.scale + 450, expected.y, .001);
      }
    }
  }
});

test('poster projection refreshes after layout changes and restores normal mode', () => {
  const camera = createCamera();
  camera.setViewport(1600, 900);
  const poster = { root: { style: { setProperty() {} } }, rect: { x: NaN, y: NaN, w: NaN, h: NaN },
    shown: { fisheye: false, projectionRevision: -1, hoverGap: NaN } };
  applyRect(poster, { x: 400, y: 200, w: 200, h: 200 }, 4);
  camera.setFisheye(true);
  syncPosterProjection(poster, camera, 1);
  const first = poster.root.style.transform;
  assert.ok(first.includes('matrix3d'));
  applyRect(poster, { x: 400, y: 200, w: 300, h: 200 }, 4);
  syncPosterProjection(poster, camera, 1);
  assert.notEqual(poster.root.style.transform, first);
  camera.setFisheye(false);
  syncPosterProjection(poster, camera, 2);
  assert.equal(poster.root.style.transform, 'translate(400px, 200px)');
});

test('nested UI corners use their own lens projection through the card parent', () => {
  const apply = (matrix, x, y) => {
    const divisor = matrix[3] * x + matrix[7] * y + matrix[15];
    return { x: (matrix[0] * x + matrix[4] * y + matrix[12]) / divisor,
      y: (matrix[1] * x + matrix[5] * y + matrix[13]) / divisor };
  };
  for (const [width, height] of [[375, 812], [1600, 900], [3840, 2160]]) {
    for (const centre of [{ x: 0, y: 0 }, { x: 1e7, y: -1e7 }]) {
      const view = { ...centre, scale: .78 }, viewport = { width, height };
      for (const amount of [0, .1, .5, 1]) for (const offset of [-900, -100, 600]) {
        const card = { x: centre.x + offset, y: centre.y - 300, w: 950, h: 900 };
        const parent = fisheyeCardMatrix(card, view, viewport, amount);
        for (const local of [{ x: 40, y: 620, w: 850, h: 240 }, { x: 40, y: 820, w: 850, h: 64 }]) {
          const correction = fisheyeChildMatrix(card, local, view, viewport, amount);
          assert.ok(correction.every(Number.isFinite));
          for (const [x, y] of [[0, 0], [local.w, 0], [local.w, local.h], [0, local.h]]) {
            const unit = apply(correction, x, y);
            const actual = apply(parent, local.x + unit.x, local.y + unit.y);
            const expected = fisheyeOffset(card.x + local.x + x - centre.x,
              card.y + local.y + y - centre.y, width / (2 * view.scale), height / (2 * view.scale), false, amount);
            near(card.x - centre.x + actual.x, expected.x, 1e-5);
            near(card.y - centre.y + actual.y, expected.y, 1e-5);
          }
        }
      }
    }
  }
});
