import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUD_DEFAULT_TILT_ANGLE, normalizeHudTiltAngle } from '../source/panel/hudSettings.ts';
import { resolveSettings, settingEntries, wallVisualsFromSettings } from '../source/panel/host/settings.ts';
import { depthSceneMatrix, depthProjectPoint } from '../source/panel/wall/depthScene.ts';

test('HUD tilt defaults preserve old settings and sanitizes the persisted degree value', () => {
  assert.equal(resolveSettings({}).hudTiltAngle, HUD_DEFAULT_TILT_ANGLE);
  for (const value of [undefined, null, NaN, Infinity, '7']) assert.equal(normalizeHudTiltAngle(value), 5.8);
  assert.equal(normalizeHudTiltAngle(-1), 0); assert.equal(normalizeHudTiltAngle(20), 10);
  assert.equal(normalizeHudTiltAngle(6.26), 6.3);
  const settings = resolveSettings({ 'pointer-3d': true, 'hud-tilt-angle': 7 });
  assert.equal(wallVisualsFromSettings(settings, false).hudTiltAngle, 7);
  assert.deepEqual(settingEntries({ hudTiltAngle: 7 }), [['hud-tilt-angle', 7]]);
});

test('0 degrees removes angular projection while retaining the HUD floating plane', () => {
  const pose = { x: 1, y: -1, amount: 1 }, viewport = { width: 1600, height: 900 };
  const flat = depthSceneMatrix(pose, viewport, 0), tilted = depthSceneMatrix(pose, viewport, 10);
  assert.equal(Math.abs(flat[3]), 0); assert.equal(Math.abs(flat[7]), 0);
  assert.ok(flat[0] > 1 && flat[12] > 0); assert.notEqual(tilted[3], 0);
  assert.deepEqual(depthSceneMatrix(pose, viewport), depthSceneMatrix(pose, viewport, 5.8));
});

test('the maximum adjustable tilt keeps corners covered and native input invertible', () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 720 }, { width: 1600, height: 900 }, { width: 5120, height: 1440 }]) {
    for (const angle of [0, 5.8, 8, 10]) for (const amount of [.1, .5, 1]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const matrix = depthSceneMatrix({ x, y, amount }, viewport, angle);
      for (const point of [{ x: 0, y: 0 }, { x: viewport.width, y: 0 }, { x: 0, y: viewport.height }, { x: viewport.width, y: viewport.height }]) {
        const source = depthProjectPoint(point, matrix, viewport, true), restored = depthProjectPoint(source, matrix, viewport);
        assert.ok(source.x >= 0 && source.x <= viewport.width && source.y >= 0 && source.y <= viewport.height);
        assert.ok(Math.abs(restored.x - point.x) < 1e-6 && Math.abs(restored.y - point.y) < 1e-6);
      }
    }
  }
});
