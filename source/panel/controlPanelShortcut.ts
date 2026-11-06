import { DEFAULT_PANEL_SHORTCUT, shortcutFromEvent } from './host/controlPanelShortcut.ts';
import { button, keyChips, row } from './controlPanelUi.ts';

const HINT = '点击后按下新的组合键，Esc 取消';
const display = (value: string): string => value.split('+').join(' + ');

/** The recorder owns only temporary listeners in this sandbox document. */
export function createControlPanelShortcut(options: {
  value: string;
  onChange(value: string): void;
  signal: AbortSignal;
}) {
  const record = button('', { className: 'control-panel__shortcut-record' });
  // Named by `render()` with the current keys, so the row label must not take over.
  record.setAttribute('aria-label', '打开功能面板的快捷键');
  const reset = button('恢复默认', { icon: 'reset', className: 'control-panel__chip' });
  const shortcutRow = row({ label: '打开功能面板', hint: HINT, controls: [record, reset] });
  const hint = shortcutRow.hint!;
  hint.setAttribute('role', 'status');
  let value = options.value;
  let recorder: AbortController | null = null;
  const render = (): void => {
    if (recorder) record.replaceChildren('请按下快捷键…');
    else record.replaceChildren(...keyChips(value));
    record.setAttribute('aria-label', recorder ? '正在录入快捷键，按 Esc 取消' : `打开功能面板的快捷键：${display(value)}，点击修改`);
    record.setAttribute('aria-pressed', String(recorder !== null));
    reset.disabled = value === DEFAULT_PANEL_SHORTCUT;
  };
  const cancel = (): void => {
    recorder?.abort();
    recorder = null;
    hint.textContent = HINT;
    render();
  };
  record.addEventListener('click', () => {
    if (recorder) { cancel(); return; }
    recorder = new AbortController();
    document.addEventListener('keydown', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === 'Escape') { cancel(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const next = shortcutFromEvent(event);
      if (!next) {
        hint.textContent = '请使用 Ctrl / Alt / ⌘ 组合键或 F1–F24，避开关闭窗口的快捷键';
        return;
      }
      cancel();
      options.onChange(next);
      hint.textContent = `已设为 ${display(next)}`;
    }, { capture: true, signal: recorder.signal });
    hint.textContent = '请按下新的快捷键；Esc 或再次点击取消';
    render();
  }, { signal: options.signal });
  reset.addEventListener('click', () => { cancel(); options.onChange(DEFAULT_PANEL_SHORTCUT); }, { signal: options.signal });
  window.addEventListener('blur', cancel, { signal: options.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, { signal: options.signal });
  options.signal.addEventListener('abort', cancel, { once: true });
  cancel();
  return {
    root: shortcutRow.root, cancel,
    get recording() { return recorder !== null; },
    sync(next: string) { if (next !== value) { value = next; cancel(); } },
  };
}
