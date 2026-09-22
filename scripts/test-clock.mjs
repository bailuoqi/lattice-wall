import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPlaybackClock,
  HARD_CORRECTION_SECONDS,
  SOFT_CORRECTION_MS,
} from '../source/panel/host/clock.ts';

const status = (overrides = {}) => ({
  state: 'playing',
  currentTrackId: 'track-a',
  positionSeconds: 40,
  durationSeconds: 221,
  volume: 1,
  ...overrides,
});

const near = (actual, expected, tolerance = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('interpolates linearly between samples while playing', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 1_000);
  near(clock.read(1_000).positionSeconds, 40);
  near(clock.read(1_250).positionSeconds, 40.25);
  near(clock.read(1_999).positionSeconds, 40.999);
  assert.equal(clock.running, true);
  assert.equal(clock.read(1_500).running, true);
  assert.equal(clock.read(1_500).durationSeconds, 221);
  assert.equal(clock.read(1_500).trackId, 'track-a');
});

test('freezes the position while paused', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ state: 'paused', positionSeconds: 12.5 }), 0);
  near(clock.read(0).positionSeconds, 12.5);
  near(clock.read(5_000).positionSeconds, 12.5);
  assert.equal(clock.running, false);
  assert.equal(clock.read(5_000).running, false);
  assert.equal(clock.read(5_000).state, 'paused');
});

test('snaps to the host value when drift reaches the hard threshold', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  const predicted = clock.read(1_000).positionSeconds;
  clock.ingest(status({ positionSeconds: predicted + HARD_CORRECTION_SECONDS }), 1_000);
  near(clock.read(1_000).positionSeconds, predicted + HARD_CORRECTION_SECONDS);
  clock.ingest(status({ positionSeconds: 10 }), 2_000);
  near(clock.read(2_000).positionSeconds, 10);
});

test('snaps when the playback state changes even for tiny drift', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  clock.ingest(status({ state: 'paused', positionSeconds: 40.9 }), 1_000);
  near(clock.read(1_000).positionSeconds, 40.9);
  near(clock.read(1_400).positionSeconds, 40.9);
  clock.ingest(status({ state: 'playing', positionSeconds: 41.1 }), 2_000);
  near(clock.read(2_000).positionSeconds, 41.1);
  near(clock.read(2_500).positionSeconds, 41.6);
});

test('snaps when the track changes', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 200 }), 0);
  clock.ingest(status({ currentTrackId: 'track-b', positionSeconds: 0.9, durationSeconds: 180 }), 1_000);
  const snapshot = clock.read(1_000);
  near(snapshot.positionSeconds, 0.9);
  assert.equal(snapshot.trackId, 'track-b');
  assert.equal(snapshot.durationSeconds, 180);
});

test('soft-converges small drift within 500 ms without going backwards', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  // Host is 0.2 s behind our prediction of 41.0.
  clock.ingest(status({ positionSeconds: 40.8 }), 1_000);
  near(clock.read(1_000).positionSeconds, 41);
  let previous = clock.read(1_000).positionSeconds;
  for (let t = 1_000; t <= 1_000 + SOFT_CORRECTION_MS; t += 20) {
    const position = clock.read(t).positionSeconds;
    assert.ok(position >= previous - 1e-9, `position went backwards at ${t}: ${previous} -> ${position}`);
    previous = position;
  }
  // After the window the correction is fully applied: 40.8 + 0.5 s of playback.
  near(clock.read(1_500).positionSeconds, 41.3);
  near(clock.read(2_000).positionSeconds, 41.8);
});

test('soft-converges forward drift too', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  clock.ingest(status({ positionSeconds: 41.3 }), 1_000);
  near(clock.read(1_000).positionSeconds, 41);
  near(clock.read(1_250).positionSeconds, 41.4);
  near(clock.read(1_500).positionSeconds, 41.8);
});

test('optimistic seek holds through two disagreeing samples, then accepts the host', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  clock.seek(100, 100);
  near(clock.read(100).positionSeconds, 100);
  near(clock.read(600).positionSeconds, 100.5);

  clock.ingest(status({ positionSeconds: 41 }), 1_000);
  near(clock.read(1_000).positionSeconds, 100.9);
  near(clock.read(1_500).positionSeconds, 101.4);

  clock.ingest(status({ positionSeconds: 42 }), 2_000);
  near(clock.read(2_000).positionSeconds, 101.9);

  clock.ingest(status({ positionSeconds: 43 }), 3_000);
  near(clock.read(3_000).positionSeconds, 43);
  near(clock.read(3_500).positionSeconds, 43.5);
});

test('optimistic seek accepts the host as soon as it agrees', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  clock.seek(100, 100);
  // Stale sample first, then the host catches up within tolerance.
  clock.ingest(status({ positionSeconds: 41 }), 1_000);
  clock.ingest(status({ positionSeconds: 101.8 }), 2_000);
  const start = clock.read(2_000).positionSeconds;
  near(start, 101.9);
  near(clock.read(2_500).positionSeconds, 102.3);
  // Optimism is spent: a later disagreeing sample snaps immediately.
  clock.ingest(status({ positionSeconds: 50 }), 3_000);
  near(clock.read(3_000).positionSeconds, 50);
});

test('optimistic seek while paused keeps the local position until the host catches up', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ state: 'paused', positionSeconds: 40 }), 0);
  clock.seek(90, 100);
  near(clock.read(500).positionSeconds, 90);
  clock.ingest(status({ state: 'paused', positionSeconds: 40 }), 1_000);
  near(clock.read(1_000).positionSeconds, 90);
  clock.ingest(status({ state: 'paused', positionSeconds: 90 }), 2_000);
  near(clock.read(2_000).positionSeconds, 90);
});

test('a track change during the optimistic window wins over the local seek', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 40 }), 0);
  clock.seek(100, 100);
  clock.ingest(status({ currentTrackId: 'track-b', positionSeconds: 0.5, durationSeconds: 200 }), 1_000);
  near(clock.read(1_000).positionSeconds, 0.5);
  assert.equal(clock.read(1_000).trackId, 'track-b');
});

test('ended freezes at the duration', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 220 }), 0);
  clock.ingest(status({ state: 'ended', positionSeconds: 220.4 }), 1_000);
  const snapshot = clock.read(1_000);
  assert.equal(snapshot.state, 'ended');
  near(snapshot.positionSeconds, 221);
  assert.equal(snapshot.running, false);
  assert.equal(clock.running, false);
  near(clock.read(9_000).positionSeconds, 221);
});

test('clamps interpolation to the duration and never below zero', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: 220.5 }), 0);
  near(clock.read(2_000).positionSeconds, 221);
  clock.seek(-5, 2_000);
  near(clock.read(2_000).positionSeconds, 0);
  clock.seek(999, 2_000);
  near(clock.read(2_000).positionSeconds, 221);
});

test('tolerates non-finite host numbers', () => {
  const clock = createPlaybackClock();
  clock.ingest(status({ positionSeconds: Number.NaN, durationSeconds: Number.POSITIVE_INFINITY }), 0);
  const snapshot = clock.read(500);
  near(snapshot.positionSeconds, 0.5);
  assert.equal(snapshot.durationSeconds, 0);
});
