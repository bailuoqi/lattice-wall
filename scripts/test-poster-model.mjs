import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTRANCE_MAX_SECONDS,
  ENTRANCE_STEP_SECONDS,
  coverVariantFor,
  coverVariantUrl,
  entranceDelaysSeconds,
  fallbackGradient,
  formatTime,
  hoverScale,
} from '../source/panel/wall/poster.ts';

test('coverVariantUrl swaps only local echo-cover variants', () => {
  assert.equal(coverVariantUrl('echo-cover://thumb/abc%20def', 'large'), 'echo-cover://large/abc%20def');
  assert.equal(coverVariantUrl('echo-cover://large/abc', 'thumb'), 'echo-cover://thumb/abc');
  assert.equal(coverVariantUrl('echo-cover://album/abc', 'thumb'), 'echo-cover://thumb/abc');
  assert.equal(coverVariantUrl('echo-cover://remote/source/x', 'album'), 'echo-cover://remote/source/x');
  assert.equal(coverVariantUrl('data:image/png;base64,AAAA', 'album'), 'data:image/png;base64,AAAA');
});

test('coverVariantFor picks the smallest variant that covers the box in device pixels', () => {
  // M cell size: 2 cells = 264 px, 3 = 400 px, 4 = 536 px, 6 = 808 px.
  assert.equal(coverVariantFor({ w: 264, h: 264 }, false, 1), 'album');
  assert.equal(coverVariantFor({ w: 400, h: 264 }, false, 1), 'album');
  assert.equal(coverVariantFor({ w: 536, h: 264 }, false, 1), 'large');
  assert.equal(coverVariantFor({ w: 264, h: 264 }, false, 1.5), 'album');
  assert.equal(coverVariantFor({ w: 400, h: 264 }, false, 1.5), 'large');
  assert.equal(coverVariantFor({ w: 264, h: 264 }, false, 2), 'large');
  assert.equal(coverVariantFor({ w: 264, h: 264 }, true, 1), 'album');
  assert.equal(coverVariantFor({ w: 264, h: 264 }, true, 1, 2), 'large');
  assert.equal(coverVariantFor({ w: 420, h: 264 }, false, 1, 1, 'large'), 'large');
  assert.equal(coverVariantFor({ w: 264, h: 264 }, false), 'album');
});

const GRADIENT_PATTERN =
  /^linear-gradient\(135deg, hsl\((\d+) (\d+)% (\d+)%\), hsl\((\d+) (\d+)% (\d+)%\)\)$/u;

function parseGradient(css) {
  const match = GRADIENT_PATTERN.exec(css);
  assert.ok(match, `not a valid two-stop gradient: ${css}`);
  const [, h1, s1, l1, h2, s2, l2] = match.map(Number);
  return { h1, s1, l1, h2, s2, l2 };
}

function hueDistance(a, b) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

const SAMPLE_IDS = [
  'track-1',
  'track-2',
  'a',
  '',
  '00000000-0000-0000-0000-000000000000',
  'local:C:/Music/アルバム/01 曲.flac',
  'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
];

test('fallbackGradient is deterministic and well-formed', () => {
  for (const id of SAMPLE_IDS) {
    const first = fallbackGradient(id);
    assert.equal(fallbackGradient(id), first);
    const { h1, s1, l1, h2, s2, l2 } = parseGradient(first);
    for (const hue of [h1, h2]) assert.ok(hue >= 0 && hue < 360, `hue out of range for ${id}`);
    assert.ok(hueDistance(h1, h2) >= 40, `hue spread too small for ${id}: ${h1} vs ${h2}`);
    for (const sat of [s1, s2]) assert.ok(sat >= 45 && sat <= 65, `saturation out of band for ${id}: ${sat}`);
    for (const light of [l1, l2]) assert.ok(light >= 28 && light <= 48, `lightness out of band for ${id}: ${light}`);
  }
});

test('fallbackGradient gives different ids different colours', () => {
  const seen = new Set(SAMPLE_IDS.map((id) => fallbackGradient(id)));
  assert.equal(seen.size, SAMPLE_IDS.length);
  const a = parseGradient(fallbackGradient('track-1'));
  const b = parseGradient(fallbackGradient('track-2'));
  assert.notEqual(a.h1, b.h1);
});

test('formatTime renders m:ss, h:mm:ss and guards bad input', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(61.9), '1:01');
  assert.equal(formatTime(221), '3:41');
  assert.equal(formatTime(3599.99), '59:59');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(36_000 + 5 * 60 + 9), '10:05:09');
  assert.equal(formatTime(Number.NaN), '0:00');
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(Number.POSITIVE_INFINITY), '0:00');
});

test('entrance shuffles tile order without mutating the mount list', () => {
  const ids = ['0:0:0', '0:0:1', '0:0:2', '-1:0:0'];
  const delays = entranceDelaysSeconds(ids, () => 0);
  assert.deepEqual(ids, ['0:0:0', '0:0:1', '0:0:2', '-1:0:0']);
  assert.deepEqual([...delays.keys()], ['0:0:1', '0:0:2', '-1:0:0', '0:0:0']);
  assert.deepEqual([...delays.values()], [0, 0.055, 0.11, 0.165]);
  assert.notDeepEqual([...entranceDelaysSeconds(ids, () => .999).keys()], [...delays.keys()]);
});

test('entrance delays cover deferred mounts, stay distinct, and cap total reveal time', () => {
  for (const count of [2, 10, 60, 250, 563]) {
    const ids = Array.from({ length: count }, (_, index) => `tile-${index}`);
    const schedule = entranceDelaysSeconds(ids, () => .5);
    const delays = [...schedule.values()];
    assert.equal(schedule.size, count);
    assert.equal(new Set(delays).size, count);
    assert.equal(delays[0], 0);
    assert.ok(delays.at(-1) <= ENTRANCE_MAX_SECONDS);
    assert.ok(Math.abs(delays.at(-1) - Math.min(ENTRANCE_MAX_SECONDS, (count - 1) * ENTRANCE_STEP_SECONDS)) < .001);
    assert.ok(ids.every(id => schedule.has(id)));
  }
});

test('entrance handles empty, single and repeated instances', () => {
  assert.equal(entranceDelaysSeconds([]).size, 0);
  assert.deepEqual([...entranceDelaysSeconds(['expanded'])], [['expanded', 0]]);
  assert.deepEqual([...entranceDelaysSeconds(['expanded', 'expanded'])], [['expanded', 0]]);
});

test('hoverScale grows a card by one gap on each axis independently', () => {
  const scale = hoverScale({ x: 0, y: 0, w: 128, h: 64 }, 8);
  assert.equal(scale.x, 136 / 128);
  assert.equal(scale.y, 72 / 64);
  const square = hoverScale({ x: 10, y: 20, w: 264, h: 264 }, 8);
  assert.equal(square.x, square.y);
  assert.ok(Math.abs(square.x - 272 / 264) < 1e-12);
  assert.deepEqual(hoverScale({ x: 0, y: 0, w: 0, h: 0 }, 8), { x: 1, y: 1 });
});
