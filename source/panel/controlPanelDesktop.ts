import type { DesktopControl, DesktopState } from './host/api.ts';

/** Optional host-owned desktop wall; unavailable hosts never show an enabled switch. */
export function createControlPanelDesktop(desktop: DesktopControl, signal: AbortSignal) {
  const root = document.createElement('section');
  root.className = 'control-panel__section';
  const button = document.createElement('button');
  button.className = 'control-panel__toggle';
  button.type = 'button';
  button.setAttribute('role', 'switch');
  const label = document.createElement('span');
  label.textContent = '桌面音乐拼贴墙';
  const track = document.createElement('span');
  track.className = 'control-panel__switch';
  track.setAttribute('aria-hidden', 'true');
  button.append(label, track);
  const hint = document.createElement('p');
  hint.className = 'control-panel__hint';
  root.append(button, hint);
  let enabled = false;
  let busy = false;
  let revision = 0;
  const render = (state: DesktopState): void => {
    enabled = state.enabled === true;
    button.disabled = state.supported !== true || busy;
    button.setAttribute('aria-checked', String(enabled));
    hint.textContent = state.supported ? '由 ECHO 管理桌面窗口与播放。' : '当前 ECHO 或平台暂不支持桌面拼贴墙。';
  };
  render({ supported: false, enabled: false });
  const open = (): void => {
    const current = ++revision;
    void desktop.get().then(state => {
      if (!signal.aborted && current === revision && !busy) render(state);
    }).catch(() => {
      if (!signal.aborted && current === revision) render({ supported: false, enabled: false });
    });
  };
  button.addEventListener('click', () => {
    if (busy || button.disabled) return;
    busy = true;
    button.disabled = true;
    const current = ++revision;
    void desktop.set(!enabled).then(state => {
      if (!signal.aborted && current === revision) { busy = false; render(state); }
    }).catch(() => {
      if (!signal.aborted && current === revision) {
        busy = false;
        hint.textContent = '桌面墙切换失败，请重试。';
        button.disabled = false;
      }
    });
  }, { signal });
  return { root, open };
}
