import type { DesktopControl, DesktopState } from './host/api.ts';
import { dimRow, press, switchRow } from './controlPanelUi.ts';

/** Optional host-owned desktop wall; unavailable hosts never show an enabled switch. */
export function createControlPanelDesktop(desktop: DesktopControl, signal: AbortSignal) {
  const toggle = switchRow({ label: '桌面音乐拼贴墙', hint: '' });
  const root = toggle.root;
  const hint = toggle.hint!;
  let enabled = false;
  let busy = false;
  let revision = 0;
  const render = (state: DesktopState): void => {
    enabled = state.enabled === true;
    root.disabled = state.supported !== true || busy;
    dimRow(root, state.supported !== true);
    press(root, enabled);
    hint.textContent = state.supported ? '把拼贴墙铺到桌面，窗口与播放由 ECHO 管理' : '当前 ECHO 或平台暂不支持桌面拼贴墙';
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
  root.addEventListener('click', () => {
    if (busy || root.disabled) return;
    busy = true;
    root.disabled = true;
    const current = ++revision;
    void desktop.set(!enabled).then(state => {
      if (!signal.aborted && current === revision) { busy = false; render(state); }
    }).catch(() => {
      if (!signal.aborted && current === revision) {
        busy = false;
        hint.textContent = '桌面墙切换失败，请重试';
        root.disabled = false;
      }
    });
  }, { signal });
  return { root, open };
}
