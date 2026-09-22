import type { PixelRect } from '../types.ts';

export type SpringState = { value: number; velocity: number };

/** Longest step the closed form integrates; a stalled frame slows the spring instead of jumping. */
const MAX_STEP_SECONDS = 0.064;
const REST_DISTANCE = 0.5;
const REST_SPEED = 5;

/**
 * Advances a critically damped spring by `dtSeconds` using the exact solution of the ODE, so the
 * result is frame-rate independent and never gains energy. Snaps to the target and returns false
 * once within 0.5 px and 5 px/s; otherwise writes the new state back and returns true.
 */
export function stepSpring(state: SpringState, target: number, dtSeconds: number, omega: number): boolean {
  const dt = Math.min(MAX_STEP_SECONDS, Math.max(0, dtSeconds));
  const x = state.value - target;
  const v = state.velocity;
  const decay = Math.exp(-omega * dt);
  const nextX = (x + (v + omega * x) * dt) * decay;
  const nextV = (v - omega * (v + omega * x) * dt) * decay;
  if (Math.abs(nextX) < REST_DISTANCE && Math.abs(nextV) < REST_SPEED) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  state.value = target + nextX;
  state.velocity = nextV;
  return true;
}

export type RectSpring = {
  /** Same object for the lifetime of the spring; read it every frame without allocating. */
  readonly current: PixelRect;
  readonly target: PixelRect;
  readonly settled: boolean;
  setTarget(rect: PixelRect): void;
  /** Jump to `rect` (or to the current target) with zero velocity. */
  snap(rect?: PixelRect): void;
  /** Returns true while any channel is still moving. */
  step(dtSeconds: number): boolean;
};

type Channel = keyof PixelRect;
const CHANNELS: readonly Channel[] = ['x', 'y', 'w', 'h'];

function copyRect(from: PixelRect, to: PixelRect): void {
  to.x = from.x;
  to.y = from.y;
  to.w = from.w;
  to.h = from.h;
}

function sameRect(a: PixelRect, b: PixelRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function createRectSpring(initial: PixelRect, omega = 14): RectSpring {
  const current: PixelRect = { x: initial.x, y: initial.y, w: initial.w, h: initial.h };
  const target: PixelRect = { x: initial.x, y: initial.y, w: initial.w, h: initial.h };
  const velocity: PixelRect = { x: 0, y: 0, w: 0, h: 0 };
  const scratch: SpringState = { value: 0, velocity: 0 };
  let settled = true;

  return {
    current,
    target,
    get settled(): boolean {
      return settled;
    },
    setTarget(rect) {
      if (sameRect(rect, target)) return;
      copyRect(rect, target);
      settled = false;
    },
    snap(rect) {
      if (rect !== undefined) copyRect(rect, target);
      copyRect(target, current);
      velocity.x = 0;
      velocity.y = 0;
      velocity.w = 0;
      velocity.h = 0;
      settled = true;
    },
    step(dtSeconds) {
      if (settled) return false;
      let moving = false;
      for (const channel of CHANNELS) {
        scratch.value = current[channel];
        scratch.velocity = velocity[channel];
        if (stepSpring(scratch, target[channel], dtSeconds, omega)) moving = true;
        current[channel] = scratch.value;
        velocity[channel] = scratch.velocity;
      }
      settled = !moving;
      return moving;
    },
  };
}
