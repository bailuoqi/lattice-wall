export const HUD_MIN_TILT_ANGLE = 0;
export const HUD_MAX_TILT_ANGLE = 10;
export const HUD_DEFAULT_TILT_ANGLE = 5.8;

/** Old settings keep the current HUD; invalid imports cannot produce a non-finite CSS matrix. */
export function normalizeHudTiltAngle(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return HUD_DEFAULT_TILT_ANGLE;
  return Math.round(Math.max(HUD_MIN_TILT_ANGLE, Math.min(HUD_MAX_TILT_ANGLE, value)) * 10) / 10;
}
