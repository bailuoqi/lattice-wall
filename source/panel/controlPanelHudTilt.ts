import type { LatticeSettings } from './types.ts';
import {
  HUD_MIN_TILT_ANGLE,
  HUD_MAX_TILT_ANGLE,
  HUD_DEFAULT_TILT_ANGLE,
  normalizeHudTiltAngle,
} from './hudSettings.ts';

/** Saves one setting update per completed drag, while the value label follows the thumb. */
export function createControlPanelHudTilt(options: {
  settings: LatticeSettings;
  onPatchSettings(patch: Partial<LatticeSettings>): void;
  signal: AbortSignal;
}): { root: HTMLElement; sync(settings: LatticeSettings): void } {
  const root = document.createElement('div');
  const row = document.createElement('label');
  row.className = 'control-panel__setting-row';
  const label = document.createElement('span');
  label.className = 'control-panel__field-label';
  label.textContent = '墙面倾斜角度';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(HUD_MIN_TILT_ANGLE);
  slider.max = String(HUD_MAX_TILT_ANGLE);
  slider.step = '0.1';
  slider.setAttribute('aria-label', 'HUD 墙面倾斜角度');
  const value = document.createElement('span');
  value.className = 'control-panel__value';
  const hint = document.createElement('p');
  hint.className = 'control-panel__hint';
  hint.id = `hud-tilt-hint-${crypto.randomUUID()}`;
  hint.textContent = `控制指针移动时的最大倾斜角度，默认 ${HUD_DEFAULT_TILT_ANGLE.toFixed(1)}°；0°保留悬浮视差。开启 HUD 后可调。`;
  slider.setAttribute('aria-describedby', hint.id);
  row.append(label, slider, value);
  root.append(row, hint);

  let settings = options.settings;
  let editing = false;
  const renderValue = (): void => {
    const angle = normalizeHudTiltAngle(Number(slider.value));
    value.textContent = `${angle.toFixed(1)}°`;
    slider.setAttribute('aria-valuetext', `${angle.toFixed(1)} 度`);
  };
  const sync = (next: LatticeSettings): void => {
    settings = next;
    slider.disabled = !next.pointer3d;
    if (!next.pointer3d) editing = false;
    if (!editing) slider.value = String(normalizeHudTiltAngle(next.hudTiltAngle));
    renderValue();
  };
  slider.addEventListener('input', () => {
    if (slider.disabled) return;
    editing = true;
    renderValue();
  }, { signal: options.signal });
  slider.addEventListener('change', () => {
    if (slider.disabled) return;
    editing = false;
    const angle = normalizeHudTiltAngle(Number(slider.value));
    slider.value = String(angle);
    renderValue();
    if (angle !== normalizeHudTiltAngle(settings.hudTiltAngle)) {
      options.onPatchSettings({ hudTiltAngle: angle });
    }
  }, { signal: options.signal });
  slider.addEventListener('pointercancel', () => {
    editing = false;
    sync(settings);
  }, { signal: options.signal });
  sync(settings);
  return { root, sync };
}
