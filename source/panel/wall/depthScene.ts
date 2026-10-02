import { HUD_DEFAULT_TILT_ANGLE, normalizeHudTiltAngle } from '../hudSettings.ts';
import type { Point } from '../types.ts';

export const HUD_ART_PARALLAX = .018;
export const HUD_ART_OVERSCAN = .065;

export type DepthPose = { x: number; y: number; amount: number };
type Viewport = { width: number; height: number };
const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

/** One perspective plane shared by native UI and the lens canvas, with enough overscan at the edges. */
export function depthSceneMatrix(pose: DepthPose, viewport: Viewport, tiltAngle = HUD_DEFAULT_TILT_ANGLE): number[] {
  const tilt = normalizeHudTiltAngle(tiltAngle);
  const pitch = -pose.y * pose.amount * tilt * (4.2 / HUD_DEFAULT_TILT_ANGLE) * Math.PI / 180;
  const yaw = pose.x * pose.amount * tilt * Math.PI / 180;
  const sx = Math.sin(pitch), cx = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  // Higher angles reserve extra wall coverage, keeping the viewport corners filled.
  const scale = 1 + .12 * pose.amount * Math.max(1, tilt / HUD_DEFAULT_TILT_ANGLE);
  const perspective = Math.max(1, viewport.width, viewport.height) * 1.35;
  return [scale * cy, scale * sx * sy, -scale * cx * sy, scale * cx * sy / perspective,
    0, scale * cx, scale * sx, -scale * sx / perspective,
    sy, -sx * cy, cx * cy, -cx * cy / perspective,
    pose.x * pose.amount * Math.min(12, viewport.width * .025),
    pose.y * pose.amount * Math.min(9, viewport.height * .025), 0, 1];
}

/** Invert the projected z=0 plane, rather than inverting a 3D point at an arbitrary screen z. */
export function depthProjectPoint(point: Point, matrix: number[], viewport: Viewport, inverse = false): Point {
  const x = point.x - viewport.width / 2, y = point.y - viewport.height / 2;
  if (!inverse) {
    const divisor = matrix[3]! * x + matrix[7]! * y + matrix[15]!;
    return { x: viewport.width / 2 + (matrix[0]! * x + matrix[4]! * y + matrix[12]!) / divisor,
      y: viewport.height / 2 + (matrix[1]! * x + matrix[5]! * y + matrix[13]!) / divisor };
  }
  const a = matrix[0]! - x * matrix[3]!, b = matrix[4]! - x * matrix[7]!;
  const c = matrix[1]! - y * matrix[3]!, d = matrix[5]! - y * matrix[7]!;
  const tx = x * matrix[15]! - matrix[12]!, ty = y * matrix[15]! - matrix[13]!;
  const divisor = a * d - b * c;
  return { x: viewport.width / 2 + (tx * d - b * ty) / divisor,
    y: viewport.height / 2 + (a * ty - tx * c) / divisor };
}

/** A bounded, frame-owner-driven motion-parallax scene. Dragging freezes the displayed pose. */
export function createDepthScene(field: HTMLElement, world: HTMLElement, requestFrame: () => void) {
  const root = document.createElement('div');
  root.className = 'wall-depth-scene';
  root.style.setProperty('--depth-art-shift', String(-HUD_ART_PARALLAX * 100) + '%');
  root.style.setProperty('--depth-art-scale', String(HUD_ART_OVERSCAN));
  field.insertBefore(root, world);
  root.append(world);
  const pose: DepthPose = { x: 0, y: 0, amount: 0 };
  let targetX = 0, targetY = 0, enabled = false, held = false, overControls = false, dirty = true;
  let viewport: Viewport = { width: field.clientWidth, height: field.clientHeight };
  let tiltAngle = HUD_DEFAULT_TILT_ANGLE;
  let matrix = depthSceneMatrix(pose, viewport, tiltAngle), lastNow: number | null = null;
  const abort = new AbortController();
  const signal = abort.signal;
  const move = (event: PointerEvent): void => {
    if (!enabled || held || event.pointerType === 'touch') return;
    overControls = event.target instanceof Element
      && event.target.closest('button, input, a, select, textarea, [role="slider"], .poster__controls') !== null;
    // Keep the displayed pose once the pointer reaches an action; UI parallax must not move the
    // intended button out from under the pointer between hover and pointerdown.
    if (overControls) return;
    const box = field.getBoundingClientRect();
    targetX = clamp((event.clientX - box.left) / Math.max(1, box.width) * 2 - 1);
    targetY = clamp((event.clientY - box.top) / Math.max(1, box.height) * 2 - 1);
    requestFrame();
  };
  field.addEventListener('pointermove', move, { signal, passive: true, capture: true });
  field.addEventListener('pointerdown', () => { held = true; }, { signal, capture: true });
  field.addEventListener('pointerleave', () => {
    if (held) return;
    overControls = false;
    targetX = targetY = 0;
    if (enabled) requestFrame();
  }, { signal });
  const release = (event: PointerEvent): void => {
    if (!held) return;
    held = false;
    // The pointer may have left the viewport during capture; resume from neutral in that case.
    const box = field.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
      overControls = false;
      targetX = targetY = 0;
      requestFrame();
    } else move(event);
  };
  field.ownerDocument.addEventListener('pointerup', release, { signal, capture: true });
  field.ownerDocument.addEventListener('pointercancel', release, { signal, capture: true });
  const resetPointer = (): void => { held = overControls = false; targetX = targetY = 0; if (enabled) requestFrame(); };
  field.addEventListener('lostpointercapture', () => { if (held) resetPointer(); }, { signal });
  field.ownerDocument.defaultView?.addEventListener('blur', resetPointer, { signal });
  return {
    root,
    pose,
    get active() { return enabled || pose.amount > 0; },
    setOptions(on: boolean, reducedMotion: boolean, requestedTilt = HUD_DEFAULT_TILT_ANGLE) {
      const nextTilt = normalizeHudTiltAngle(requestedTilt);
      const next = on && !reducedMotion;
      if (next === enabled && !reducedMotion && nextTilt === tiltAngle) return;
      tiltAngle = nextTilt;
      enabled = next;
      if (!enabled) { targetX = targetY = 0; overControls = false; }
      if (reducedMotion) pose.x = pose.y = pose.amount = 0;
      dirty = true;
      requestFrame();
    },
    tick(nowMs: number, next: Viewport): { changed: boolean; moving: boolean } {
      const dt = lastNow === null ? 1 / 60 : Math.min(.064, Math.max(0, (nowMs - lastNow) / 1000));
      lastNow = nowMs;
      let changed = dirty || viewport.width !== next.width || viewport.height !== next.height;
      viewport = next;
      let moving = false;
      if (!held) for (const [key, target] of [['x', targetX], ['y', targetY], ['amount', enabled ? 1 : 0]] as const) {
        if (overControls && enabled && key !== 'amount') continue;
        const before = pose[key];
        pose[key] += (target - before) * (1 - Math.exp(-dt * (key === 'amount' ? 15 : 11)));
        if (Math.abs(target - pose[key]) < .0001) pose[key] = target;
        else moving = true;
        if (pose[key] !== before) changed = true;
      }
      if (changed) {
        matrix = depthSceneMatrix(pose, viewport, tiltAngle);
        root.style.transform = pose.amount > 0 ? `matrix3d(${matrix.join(',')})` : '';
        root.style.willChange = this.active ? 'transform' : '';
        root.dataset.depthActive = String(this.active);
        world.dataset.depth = String(this.active);
        for (const [name, value] of [['x', pose.x], ['y', pose.y], ['amount', pose.amount]] as const) {
          root.style.setProperty(`--depth-${name}`, String(value));
        }
        dirty = false;
      }
      return { changed, moving };
    },
    pointerPoint(clientX: number, clientY: number): Point {
      const box = field.getBoundingClientRect();
      return depthProjectPoint({ x: clientX - box.left, y: clientY - box.top }, matrix, viewport, true);
    },
    screenPoint(point: Point): Point { return depthProjectPoint(point, matrix, viewport); },
    dispose() { abort.abort(); root.replaceWith(world); delete world.dataset.depth; },
  };
}
