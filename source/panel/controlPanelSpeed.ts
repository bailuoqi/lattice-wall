import type { SpeedControl } from './host/api.ts';

const clampRate = (rate: number): number => Math.max(0.5, Math.min(2, rate));

export const createControlPanelSpeed = (speed: SpeedControl) => {
  const root = document.createElement('section');
  root.className = 'control-panel__section control-panel__speed';
  const title = document.createElement('h3');
  title.className = 'control-panel__label';
  title.textContent = '播放速度';
  const row = document.createElement('div');
  row.className = 'control-panel__row';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0.5';
  slider.max = '2';
  slider.step = '0.05';
  slider.value = '1';
  slider.setAttribute('aria-label', '播放速度');
  const value = document.createElement('span');
  value.className = 'control-panel__value';
  const render = (rate: number): void => {
    slider.value = String(clampRate(rate));
    value.textContent = `${clampRate(rate).toFixed(2)}×`;
  };
  render(1);
  row.append(slider, value);
  root.append(title, row);

  let disposed = false;
  let busy = false;
  let dragging = false;
  let revision = 0;
  let off: (() => void) | null = null;
  const onInput = (): void => { value.textContent = `${Number(slider.value).toFixed(2)}×`; };
  const onChange = (): void => {
    dragging = false;
    if (busy) return;
    busy = true;
    slider.disabled = true;
    const currentRevision = ++revision;
    void speed.set(Number(slider.value)).then((rate) => {
      if (!disposed && revision === currentRevision) render(rate);
    }).catch(() => {
      if (!disposed) void speed.get().then(rate => {
        if (!disposed && revision === currentRevision) render(rate);
      }).catch(() => undefined);
    }).finally(() => {
      if (!disposed) { busy = false; slider.disabled = false; }
    });
  };
  slider.addEventListener('input', onInput);
  slider.addEventListener('change', onChange);
  const onPointerDown = (): void => { dragging = true; };
  const onPointerUp = (): void => { dragging = false; };
  slider.addEventListener('pointerdown', onPointerDown);
  slider.addEventListener('pointerup', onPointerUp);
  slider.addEventListener('pointercancel', onPointerUp);
  return {
    root,
    open: () => {
      if (disposed || off) return;
      off = speed.onChanged((rate) => {
        if (!disposed && !busy && !dragging) render(rate);
      });
      const requestRevision = revision;
      slider.disabled = true;
      void speed.get().then((rate) => {
        if (!disposed && off && !busy && !dragging && revision === requestRevision) {
          slider.disabled = false; render(rate);
        }
      }).catch(() => { if (!disposed && off && revision === requestRevision) value.textContent = '不可用'; });
    },
    close: () => {
      off?.();
      off = null;
    },
    dispose: () => {
      disposed = true;
      off?.();
      off = null;
      slider.removeEventListener('input', onInput);
      slider.removeEventListener('change', onChange);
      slider.removeEventListener('pointerdown', onPointerDown);
      slider.removeEventListener('pointerup', onPointerUp);
      slider.removeEventListener('pointercancel', onPointerUp);
    },
  };
};
