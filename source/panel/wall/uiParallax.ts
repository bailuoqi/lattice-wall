import type { PixelRect, Point } from '../types.ts';
import type { DepthPose } from './depthScene.ts';

export type UiDepthLayer = 'meta' | 'lyrics' | 'controls' | 'caption';
const DISTANCE: Record<UiDepthLayer, number> = { meta: 26, lyrics: 18, controls: 32, caption: 10 };

/** Foreground layers follow the viewer at different depths; artwork moves in the opposite direction.
 * Return projected world offsets so camera zoom cannot exaggerate the motion. Smaller cards reserve
 * their edge padding, and the vertical motion leaves the animated lyric/control gaps open. */
export function uiParallaxOffset(pose: DepthPose, layer: UiDepthLayer, card: PixelRect, scale: number,
  viewport: Readonly<{ width: number; height: number }>): Point {
  if (pose.amount <= 0 || scale <= 0) return { x: 0, y: 0 };
  // Scale the layer distances together so smaller viewports retain distinct depths.
  const reach = Math.min(DISTANCE.controls, viewport.width * .035, viewport.height * .035,
    Math.min(card.w, card.h) * scale * .05);
  const distance = reach * DISTANCE[layer] / DISTANCE.controls;
  return { x: pose.x * pose.amount * distance / scale,
    y: pose.y * pose.amount * distance * .45 / scale };
}
