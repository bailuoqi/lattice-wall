import type { Camera, CameraState, PixelRect, Point } from '../types.ts';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
/** Inertia decay in s⁻¹: speed follows v(t) = v₀·e^(−k·t). */
const INERTIA_DECAY = 4.2;
/** Releases slower than this (screen px/s) are a plain stop, not a fling. */
const FLING_MIN_SPEED = 40;
/** Coasting ends once the screen-space speed drops below this (px/s). */
const INERTIA_STOP_SPEED = 5;
/** Longest frame either animation integrates; a stalled rAF loop slows the motion instead of jumping. */
const MAX_FRAME_MS = 50;

type Flight = {
  fromX: number;
  fromY: number;
  fromScale: number;
  toX: number;
  toY: number;
  toScale: number;
  durationMs: number;
  elapsedMs: number;
  /** Null until the first tick establishes the time base. */
  lastMs: number | null;
};

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function clampFrame(deltaMs: number): number {
  return Math.min(MAX_FRAME_MS, Math.max(0, deltaMs));
}

function easeOutCubic(t: number): number {
  const remaining = 1 - t;
  return 1 - remaining * remaining * remaining;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function createCamera(initial?: Partial<CameraState>): Camera {
  let cx = initial?.x ?? 0;
  let cy = initial?.y ?? 0;
  let scale = clampScale(initial?.scale ?? 1);
  let viewportWidth = 0;
  let viewportHeight = 0;

  let flight: Flight | null = null;
  let coasting = false;
  let inertiaVx = 0;
  let inertiaVy = 0;
  let inertiaLastMs: number | null = null;
  // Set by instant moves (pan, setCenter, setScale, instant flyTo) so the next tick reports the change.
  let dirty = false;

  // Live read-only views: readers see the current values without per-frame allocation, and cannot
  // write back. Copy the fields if a snapshot is needed.
  const state: Readonly<CameraState> = Object.freeze({
    get x(): number {
      return cx;
    },
    get y(): number {
      return cy;
    },
    get scale(): number {
      return scale;
    },
  });
  const viewport = Object.freeze({
    get width(): number {
      return viewportWidth;
    },
    get height(): number {
      return viewportHeight;
    },
  });

  function cancel(): void {
    flight = null;
    coasting = false;
  }

  function tickFlight(current: Flight, nowMs: number): boolean {
    if (current.lastMs === null) {
      current.lastMs = nowMs;
      return false;
    }
    current.elapsedMs += clampFrame(nowMs - current.lastMs);
    current.lastMs = nowMs;

    let nextX: number;
    let nextY: number;
    let nextScale: number;
    if (current.elapsedMs >= current.durationMs) {
      nextX = current.toX;
      nextY = current.toY;
      nextScale = current.toScale;
      flight = null;
    } else {
      const progress = easeOutCubic(current.elapsedMs / current.durationMs);
      nextX = current.fromX + (current.toX - current.fromX) * progress;
      nextY = current.fromY + (current.toY - current.fromY) * progress;
      nextScale = current.fromScale + (current.toScale - current.fromScale) * progress;
    }
    const changed = nextX !== cx || nextY !== cy || nextScale !== scale;
    cx = nextX;
    cy = nextY;
    scale = nextScale;
    return changed;
  }

  function tickInertia(nowMs: number): boolean {
    if (inertiaLastMs === null) {
      inertiaLastMs = nowMs;
      return false;
    }
    const dt = clampFrame(nowMs - inertiaLastMs) / 1000;
    inertiaLastMs = nowMs;
    if (dt === 0) return false;

    const decay = Math.exp(-INERTIA_DECAY * dt);
    // Exact integral of the decaying velocity over the frame, in screen px per (px/s) of velocity.
    const travel = (1 - decay) / INERTIA_DECAY;
    cx -= (inertiaVx * travel) / scale;
    cy -= (inertiaVy * travel) / scale;
    inertiaVx *= decay;
    inertiaVy *= decay;
    if (Math.hypot(inertiaVx, inertiaVy) < INERTIA_STOP_SPEED) coasting = false;
    return true;
  }

  const camera: Camera = {
    state,
    viewport,
    get animating(): boolean {
      return flight !== null || coasting;
    },
    setViewport(width, height) {
      viewportWidth = width;
      viewportHeight = height;
    },
    setCenter(x, y) {
      cancel();
      dirty = dirty || x !== cx || y !== cy;
      cx = x;
      cy = y;
    },
    setScale(next) {
      cancel();
      const clamped = clampScale(next);
      dirty = dirty || clamped !== scale;
      scale = clamped;
    },
    flyTo(target, durationMs) {
      const toScale = clampScale(target.scale ?? scale);
      coasting = false;
      if (durationMs <= 0 || (target.x === cx && target.y === cy && toScale === scale)) {
        flight = null;
        dirty = dirty || target.x !== cx || target.y !== cy || toScale !== scale;
        cx = target.x;
        cy = target.y;
        scale = toScale;
        return;
      }
      flight = {
        fromX: cx,
        fromY: cy,
        fromScale: scale,
        toX: target.x,
        toY: target.y,
        toScale,
        durationMs,
        elapsedMs: 0,
        lastMs: null,
      };
    },
    panBy(dx, dy) {
      cancel();
      if (dx === 0 && dy === 0) return;
      dirty = true;
      cx -= dx / scale;
      cy -= dy / scale;
    },
    fling(vx, vy) {
      if (Math.hypot(vx, vy) < FLING_MIN_SPEED) return;
      flight = null;
      coasting = true;
      inertiaVx = vx;
      inertiaVy = vy;
      inertiaLastMs = null;
    },
    stop: cancel,
    tick(nowMs) {
      const moved = dirty;
      dirty = false;
      if (flight !== null) return tickFlight(flight, nowMs) || moved;
      if (coasting) return tickInertia(nowMs) || moved;
      return moved;
    },
    bounds(): PixelRect {
      const w = viewportWidth / scale;
      const h = viewportHeight / scale;
      return { x: cx - w / 2, y: cy - h / 2, w, h };
    },
    screenToWorld(px, py): Point {
      return {
        x: cx + (px - viewportWidth / 2) / scale,
        y: cy + (py - viewportHeight / 2) / scale,
      };
    },
    worldToScreen(x, y): Point {
      return {
        x: (x - cx) * scale + viewportWidth / 2,
        y: (y - cy) * scale + viewportHeight / 2,
      };
    },
    transform() {
      // One displayed scale for both translate and scale(). Rounding them independently
      // leaves the world origin drifting by cx·Δs — violent shake while zooming far from 0.
      const displayScale = roundTo(scale, 4);
      const tx = roundTo(viewportWidth / 2 - cx * displayScale, 2);
      const ty = roundTo(viewportHeight / 2 - cy * displayScale, 2);
      return `translate3d(${tx}px, ${ty}px, 0) scale(${displayScale})`;
    },
  };
  return camera;
}
