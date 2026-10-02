import type { Camera, CameraState, PixelRect, Point } from '../types.ts';

const STRENGTH = 2;
const NORMALIZATION = Math.asinh(STRENGTH);

/** Smooth, invertible barrel projection; the viewport axes stay anchored at their edges. */
export function fisheyeOffset(x: number, y: number, halfWidth: number, halfHeight: number, inverse = false, amount = 1): Point {
  if (!(halfWidth > 0 && halfHeight > 0) || amount <= 0) return { x, y };
  const strength = STRENGTH * amount;
  const normalization = amount === 1 ? NORMALIZATION : Math.asinh(strength);
  const radius = Math.hypot(x / halfWidth, y / halfHeight);
  if (radius === 0) return { x, y };
  const mapped = inverse ? Math.sinh(radius * normalization) / strength
    : Math.asinh(radius * strength) / normalization;
  const factor = mapped / radius;
  return { x: x * factor, y: y * factor };
}

/** The inverse-projected screen corners bound every visible source point. */
export const FISHEYE_BOUNDS_SCALE = fisheyeOffset(1, 1, 1, 1, true).x;

export function projectedCardBounds(rect: PixelRect, camera: Pick<Camera, 'worldToScreen'>): PixelRect {
  const corners = [camera.worldToScreen(rect.x, rect.y), camera.worldToScreen(rect.x + rect.w, rect.y),
    camera.worldToScreen(rect.x + rect.w, rect.y + rect.h), camera.worldToScreen(rect.x, rect.y + rect.h)];
  const left = Math.min(...corners.map(point => point.x)), top = Math.min(...corners.map(point => point.y));
  return { x: left, y: top, w: Math.max(...corners.map(point => point.x)) - left,
    h: Math.max(...corners.map(point => point.y)) - top };
}

/** Project a card's four corners with a homography, retaining native DOM hit testing. */
export function fisheyeCardMatrix(rect: PixelRect, view: Readonly<CameraState>, viewport: Readonly<{ width: number; height: number }>, amount = 1): number[] {
  const halfWidth = viewport.width / (2 * view.scale);
  const halfHeight = viewport.height / (2 * view.scale);
  const corner = (x: number, y: number): Point => {
    const offset = fisheyeOffset(x - view.x, y - view.y, halfWidth, halfHeight, false, amount);
    // Keep the matrix near the card's local origin, even after very long pans.
    return { x: view.x + offset.x - rect.x, y: view.y + offset.y - rect.y };
  };
  const p0 = corner(rect.x, rect.y);
  const p1 = corner(rect.x + rect.w, rect.y);
  const p2 = corner(rect.x + rect.w, rect.y + rect.h);
  const p3 = corner(rect.x, rect.y + rect.h);
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) > 1e-12 ? (dx3 * dy2 - dx2 * dy3) / denominator : 0;
  const h = Math.abs(denominator) > 1e-12 ? (dx1 * dy3 - dx3 * dy1) / denominator : 0;
  const width = Math.max(1, rect.w), height = Math.max(1, rect.h);
  return [
    (p1.x - p0.x + g * p1.x) / width, (p1.y - p0.y + g * p1.y) / width, 0, g / width,
    (p3.x - p0.x + h * p3.x) / height, (p3.y - p0.y + h * p3.y) / height, 0, h / height,
    0, 0, 1, 0,
    p0.x, p0.y, 0, 1,
  ];
}

type Homography = [number, number, number, number, number, number, number, number, number];

function planar(matrix: number[]): Homography {
  return [matrix[0]!, matrix[4]!, matrix[12]!, matrix[1]!, matrix[5]!, matrix[13]!, matrix[3]!, matrix[7]!, matrix[15]!];
}

function multiply(a: Homography, b: Homography): Homography {
  const result = new Array<number>(9).fill(0) as Homography;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    for (let k = 0; k < 3; k++) result[row * 3 + col]! += a[row * 3 + k]! * b[k * 3 + col]!;
  }
  return result;
}

function inverse([a, b, c, d, e, f, g, h, i]: Homography): Homography {
  const cofactors: Homography = [e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d];
  const determinant = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  return cofactors.map(value => value / determinant) as Homography;
}

/** Cancel the card's planar warp, then project a UI unit at its own place on the curved cover.
 * Work relative to the card origin so a long pan cannot lose precision in matrix inversion. */
export function fisheyeChildMatrix(card: PixelRect, local: PixelRect, view: Readonly<CameraState>,
  viewport: Readonly<{ width: number; height: number }>, amount = 1, shift: Point = { x: 0, y: 0 }, projectUnit = true): number[] {
  const parent = planar(fisheyeCardMatrix(card, view, viewport, amount));
  const child = planar(fisheyeCardMatrix({ x: card.x + local.x, y: card.y + local.y,
    w: local.w, h: local.h }, view, viewport, amount));
  const offset: Homography = [1, 0, local.x, 0, 1, local.y, 0, 0, 1];
  const undoOffset: Homography = [1, 0, -local.x, 0, 1, -local.y, 0, 0, 1];
  const translation: Homography = [1, 0, shift.x, 0, 1, shift.y, 0, 0, 1];
  // Translate after the lens in the camera plane. Keep the parent's native projection when the
  // continuous surface is unavailable, instead of changing the fallback cover/UI correspondence.
  const projected = projectUnit ? multiply(offset, child) : multiply(parent, offset);
  const result = multiply(multiply(multiply(undoOffset, inverse(parent)), translation), projected);
  const [a, b, c, d, e, f, g, h, i] = result.map(value => value / result[8]) as Homography;
  return [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i];
}
