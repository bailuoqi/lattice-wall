import type { ClockSnapshot, PlaybackClock } from '../types.ts';

/** Drift at or above this many seconds snaps to the host value instead of gliding. */
export const HARD_CORRECTION_SECONDS = 0.35;
/** Soft corrections are spread linearly over this window so the progress bar never jumps. */
export const SOFT_CORRECTION_MS = 500;
/** Host samples a local seek may lag behind before the host value wins again. */
export const OPTIMISTIC_SEEK_SAMPLES = 2;

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export function createPlaybackClock(): PlaybackClock {
  // `base` is the position shown at `sampledAt`; while playing the clock extrapolates from there.
  let base = 0;
  let sampledAt = 0;
  let duration = 0;
  let state = 'stopped';
  let trackId: string | null = null;
  let hasSample = false;
  // A pending soft correction: `softDelta` seconds folded in linearly from `softStart`.
  let softDelta = 0;
  let softStart = 0;
  // Remaining host samples allowed to disagree with a local seek before the host wins.
  let optimisticHold = 0;

  const clampToDuration = (position: number): number => {
    if (position < 0) return 0;
    return duration > 0 && position > duration ? duration : position;
  };

  const positionAt = (nowMs: number): number => {
    let position = base;
    if (state === 'playing') position += Math.max(0, nowMs - sampledAt) / 1000;
    if (softDelta !== 0) position += softDelta * clamp01((nowMs - softStart) / SOFT_CORRECTION_MS);
    return clampToDuration(position);
  };

  const rebase = (position: number, nowMs: number): void => {
    base = position;
    sampledAt = nowMs;
    softDelta = 0;
  };

  const ingest = (status: EchoWorkshopPlaybackStatus, nowMs: number): void => {
    const incomingState = typeof status.state === 'string' ? status.state : 'stopped';
    const incomingTrack = typeof status.currentTrackId === 'string' ? status.currentTrackId : null;
    const incomingPosition = Math.max(0, finiteOr(status.positionSeconds, 0));
    const predicted = positionAt(nowMs);

    const first = !hasSample;
    const stateChanged = incomingState !== state;
    const trackChanged = incomingTrack !== trackId;
    duration = Math.max(0, finiteOr(status.durationSeconds, 0));
    state = incomingState;
    trackId = incomingTrack;
    hasSample = true;

    const hostPosition = incomingState === 'ended' && duration > 0 ? duration : incomingPosition;
    const drift = hostPosition - predicted;
    const agrees = Math.abs(drift) < HARD_CORRECTION_SECONDS;

    if (optimisticHold > 0 && !first && !stateChanged && !trackChanged && !agrees) {
      // The host has not applied our seek yet (its sample predates it); keep the local position.
      optimisticHold -= 1;
      rebase(clampToDuration(predicted), nowMs);
      return;
    }
    optimisticHold = 0;

    if (first || stateChanged || trackChanged || !agrees) {
      rebase(clampToDuration(hostPosition), nowMs);
      return;
    }
    rebase(clampToDuration(predicted), nowMs);
    softDelta = drift;
    softStart = nowMs;
  };

  const seek = (positionSeconds: number, nowMs: number): void => {
    rebase(clampToDuration(Math.max(0, finiteOr(positionSeconds, 0))), nowMs);
    optimisticHold = OPTIMISTIC_SEEK_SAMPLES;
  };

  const read = (nowMs: number): ClockSnapshot => ({
    positionSeconds: positionAt(nowMs),
    durationSeconds: duration,
    state,
    trackId,
    running: state === 'playing',
  });

  return {
    ingest,
    seek,
    read,
    get running(): boolean {
      return state === 'playing';
    },
  };
}
