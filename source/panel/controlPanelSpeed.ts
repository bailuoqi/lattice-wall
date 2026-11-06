import type { SpeedControl } from './host/api.ts';
import { button, row, slider } from './controlPanelUi.ts';

const clampRate = (rate: number): number => Math.max(0.5, Math.min(2, rate));
const HINT = '0.5× – 2×，松开滑杆后应用';

export const createControlPanelSpeed = (speed: SpeedControl) => {
  const rate = slider({ min: 0.5, max: 2, step: 0.05, format: value => `${value.toFixed(2)}×`, spoken: value => `${value.toFixed(2)} 倍` });
  const reset = button('1×', { className: 'control-panel__chip', label: '恢复 1 倍速' });
  const speedRow = row({ label: '播放速度', hint: HINT, wide: true, controls: [rate.input, rate.value, reset] });
  const render = (value: number): void => {
    rate.input.value = String(clampRate(value));
    rate.render();
    reset.disabled = rate.input.disabled || Number(rate.input.value) === 1;
  };
  const setEnabled = (on: boolean): void => {
    rate.input.disabled = !on;
    reset.disabled = !on || Number(rate.input.value) === 1;
  };
  render(1);

  let disposed = false;
  let busy = false;
  let dragging = false;
  let revision = 0;
  let off: (() => void) | null = null;
  const onInput = (): void => { rate.render(); };
  const commit = (): void => {
    dragging = false;
    if (busy) return;
    busy = true;
    setEnabled(false);
    const currentRevision = ++revision;
    void speed.set(Number(rate.input.value)).then((value) => {
      if (!disposed && revision === currentRevision) render(value);
    }).catch(() => {
      if (!disposed) void speed.get().then(value => {
        if (!disposed && revision === currentRevision) render(value);
      }).catch(() => undefined);
    }).finally(() => {
      if (!disposed) { busy = false; setEnabled(true); }
    });
  };
  const onReset = (): void => {
    if (busy || Number(rate.input.value) === 1) return;
    rate.input.value = '1';
    rate.render();
    commit();
  };
  rate.input.addEventListener('input', onInput);
  rate.input.addEventListener('change', commit);
  reset.addEventListener('click', onReset);
  const onPointerDown = (): void => { dragging = true; };
  const onPointerUp = (): void => { dragging = false; };
  rate.input.addEventListener('pointerdown', onPointerDown);
  rate.input.addEventListener('pointerup', onPointerUp);
  rate.input.addEventListener('pointercancel', onPointerUp);
  return {
    /** Setting row; the panel places it in a group. */
    root: speedRow.root,
    open: () => {
      if (disposed || off) return;
      off = speed.onChanged((value) => {
        if (!disposed && !busy && !dragging) render(value);
      });
      const requestRevision = revision;
      setEnabled(false);
      void speed.get().then((value) => {
        if (!disposed && off && !busy && !dragging && revision === requestRevision) {
          setEnabled(true); render(value);
          if (speedRow.hint) speedRow.hint.textContent = HINT;
        }
      }).catch(() => {
        if (!disposed && off && revision === requestRevision) {
          rate.value.textContent = '—';
          if (speedRow.hint) speedRow.hint.textContent = '当前 ECHO 暂不支持变速';
        }
      });
    },
    close: () => {
      off?.();
      off = null;
    },
    dispose: () => {
      disposed = true;
      off?.();
      off = null;
      rate.input.removeEventListener('input', onInput);
      rate.input.removeEventListener('change', commit);
      reset.removeEventListener('click', onReset);
      rate.input.removeEventListener('pointerdown', onPointerDown);
      rate.input.removeEventListener('pointerup', onPointerUp);
      rate.input.removeEventListener('pointercancel', onPointerUp);
    },
  };
};
