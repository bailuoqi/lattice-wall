import assert from 'node:assert/strict';
import { test } from 'node:test';
import { depthProjectPoint, depthSceneMatrix } from '../source/panel/wall/depthScene.ts';
import { createCamera } from '../source/panel/wall/camera.ts';
import { uiParallaxOffset } from '../source/panel/wall/uiParallax.ts';
import { fisheyeCardMatrix, fisheyeChildMatrix } from '../source/panel/wall/fisheye.ts';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test('perspective input stays aligned with the wall, including the lens and long camera pans', () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1600, height: 900 }, { width: 3840, height: 2160 }]) {
    const camera = createCamera({ x: 1e7, y: -1e7, scale: .78 });
    camera.setViewport(viewport.width, viewport.height);
    for (const fisheye of [false, true]) {
      camera.setFisheye(fisheye);
      for (const pose of [{ x: 0, y: 0, amount: 0 }, { x: -.8, y: .6, amount: .4 }, { x: 1, y: -1, amount: 1 }]) {
        const matrix = depthSceneMatrix(pose, viewport);
        for (const point of [{ x: 0, y: 0 }, { x: viewport.width / 2, y: viewport.height / 2 }, { x: viewport.width, y: viewport.height }]) {
          const source = camera.screenToWorld(point.x, point.y);
          const screen = depthProjectPoint(camera.worldToScreen(source.x, source.y), matrix, viewport);
          const plane = depthProjectPoint(screen, matrix, viewport, true);
          const picked = camera.screenToWorld(plane.x, plane.y);
          near(picked.x, source.x); near(picked.y, source.y);
        }
      }
    }
  }
});

test('scene overscan fills all four viewport corners at extreme pointer positions and during entry', () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1600, height: 900 }, { width: 3840, height: 2160 }]) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const amount of [.1, .5, 1]) {
      const matrix = depthSceneMatrix({ x, y, amount }, viewport);
      for (const screen of [{ x: 0, y: 0 }, { x: viewport.width, y: 0 }, { x: 0, y: viewport.height }, { x: viewport.width, y: viewport.height }]) {
        const source = depthProjectPoint(screen, matrix, viewport, true);
        assert.ok(source.x >= 0 && source.x <= viewport.width && source.y >= 0 && source.y <= viewport.height,
          `${JSON.stringify({ viewport, x, y, amount, source })} leaves a black viewport edge`);
      }
    }
  }
});

test('foreground depths have different motion, stable screen distances and zero offset when disabled', () => {
  const card = { x: 0, y: 0, w: 1200, h: 1200 }, viewport = { width: 1600, height: 1200 };
  const pose = { x: .8, y: -.6, amount: 1 };
  for (const scale of [.6, 1.3]) {
    const title = uiParallaxOffset(pose, 'meta', card, scale, viewport);
    const lyrics = uiParallaxOffset(pose, 'lyrics', card, scale, viewport);
    const controls = uiParallaxOffset(pose, 'controls', card, scale, viewport);
    near(title.x * scale, .8 * 26); near(controls.x * scale, .8 * 32);
    assert.ok(controls.x > title.x && title.x > lyrics.x);
    assert.deepEqual(uiParallaxOffset({ ...pose, amount: 0 }, 'controls', card, scale, viewport), { x: 0, y: 0 });
  }
  const small = { ...card, w: 260, h: 260 };
  const shift = uiParallaxOffset(pose, 'controls', small, .42, { width: 375, height: 812 });
  assert.ok(Math.abs(shift.x * .42) < small.w * .42 * .05);
});

test('UI parallax translates after the fish lens and retains native fallback geometry', () => {
  const viewport = { width: 1600, height: 900 }, view = { x: 0, y: 0, scale: .78 };
  const card = { x: 540, y: -240, w: 788, h: 788 }, local = { x: 40, y: 640, w: 708, h: 64 };
  const shift = uiParallaxOffset({ x: .9, y: -.8, amount: 1 }, 'controls', card, view.scale, viewport);
  const apply = (matrix, x, y) => {
    const w = matrix[3] * x + matrix[7] * y + matrix[15];
    return { x: (matrix[0] * x + matrix[4] * y + matrix[12]) / w,
      y: (matrix[1] * x + matrix[5] * y + matrix[13]) / w };
  };
  for (const amount of [0, .5, 1]) for (const surface of [false, true]) {
    const parent = fisheyeCardMatrix(card, view, viewport, amount);
    const base = fisheyeChildMatrix(card, local, view, viewport, amount, { x: 0, y: 0 }, surface);
    const moved = fisheyeChildMatrix(card, local, view, viewport, amount, shift, surface);
    for (const [x, y] of [[0, 0], [local.w, 0], [0, local.h], [local.w, local.h]]) {
      const b = apply(base, x, y), m = apply(moved, x, y);
      const before = apply(parent, local.x + b.x, local.y + b.y);
      const after = apply(parent, local.x + m.x, local.y + m.y);
      near(after.x - before.x, shift.x); near(after.y - before.y, shift.y);
    }
  }
});
