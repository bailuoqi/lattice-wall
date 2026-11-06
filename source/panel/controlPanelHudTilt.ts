import type { LatticeSettings } from './types.ts';
import {
  HUD_MIN_TILT_ANGLE,
  HUD_MAX_TILT_ANGLE,
  HUD_DEFAULT_TILT_ANGLE,
  normalizeHudTiltAngle,
} from './hudSettings.ts';
import { dimRow, row, slider } from './controlPanelUi.ts';

const ON_HINT = `最大倾斜角，默认 ${HUD_DEFAULT_TILT_ANGLE.toFixed(1)}°；0° 只保留悬浮视差`;
const OFF_HINT = '开启 HUD 后可调';

/** Saves one setting update per completed drag, while the value label follows the thumb. */
export function createControlPanelHudTilt(options: {
  settings: LatticeSettings;
  onPatchSettings(patch: Partial<LatticeSettings>): void;
  signal: AbortSignal;
}): { root: HTMLElement; sync(settings: LatticeSettings): void } {
  const angle = slider({
    min: HUD_MIN_TILT_ANGLE,
    max: HUD_MAX_TILT_ANGLE,
    step: 0.1,
    format: value => `${normalizeHudTiltAngle(value).toFixed(1)}°`,
    spoken: value => `${normalizeHudTiltAngle(value).toFixed(1)} 度`,
  });
  const tiltRow = row({ label: '墙面倾斜角度', hint: ON_HINT, sub: true, wide: true, controls: [angle.input, angle.value] });

  let settings = options.settings;
  let editing = false;
  const sync = (next: LatticeSettings): void => {
    settings = next;
    angle.input.disabled = !next.pointer3d;
    dimRow(tiltRow.root, !next.pointer3d);
    if (tiltRow.hint) tiltRow.hint.textContent = next.pointer3d ? ON_HINT : OFF_HINT;
    if (!next.pointer3d) editing = false;
    if (!editing) angle.input.value = String(normalizeHudTiltAngle(next.hudTiltAngle));
    angle.render();
  };
  angle.input.addEventListener('input', () => {
    if (angle.input.disabled) return;
    editing = true;
    angle.render();
  }, { signal: options.signal });
  angle.input.addEventListener('change', () => {
    if (angle.input.disabled) return;
    editing = false;
    const value = normalizeHudTiltAngle(Number(angle.input.value));
    angle.input.value = String(value);
    angle.render();
    if (value !== normalizeHudTiltAngle(settings.hudTiltAngle)) {
      options.onPatchSettings({ hudTiltAngle: value });
    }
  }, { signal: options.signal });
  angle.input.addEventListener('pointercancel', () => {
    editing = false;
    sync(settings);
  }, { signal: options.signal });
  sync(settings);
  return { root: tiltRow.root, sync };
}
