import { DEFAULT_PANEL_SHORTCUT, shortcutFromEvent } from './host/controlPanelShortcut.ts';

const HINT = '点击快捷键后录入组合键或 F1–F24，按 Esc 取消。仅在拼贴墙内生效。';
const display = (value: string): string => value.split('+').join(' + ');

/** The recorder owns only temporary listeners in this sandbox document. */
export function createControlPanelShortcut(options: {
  value: string;
  onChange(value: string): void;
  signal: AbortSignal;
}) {
  const root = document.createElement('section');
  root.className = 'control-panel__section';
  const title = document.createElement('h3');
  title.className = 'control-panel__label';
  title.textContent = '快捷键';
  const row = document.createElement('div');
  row.className = 'control-panel__setting-row control-panel__shortcut-setting';
  const label = document.createElement('span');
  label.className = 'control-panel__field-label';
  label.textContent = '打开功能面板';
  const actions = document.createElement('div');
  actions.className = 'control-panel__row';
  const record = document.createElement('button');
  record.type = 'button';
  record.className = 'control-panel__shortcut-record';
  record.setAttribute('aria-label', '设置打开功能面板的快捷键');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复默认';
  const hint = document.createElement('p');
  hint.className = 'control-panel__hint';
  hint.id = `panel-shortcut-hint-${crypto.randomUUID()}`;
  hint.setAttribute('role', 'status');
  record.setAttribute('aria-describedby', hint.id);
  actions.append(record, reset);
  row.append(label, actions);
  root.append(title, row, hint);
  let value = options.value;
  let recorder: AbortController | null = null;
  const render = (): void => {
    record.textContent = recorder ? '请按下快捷键…' : display(value);
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
        hint.textContent = '请使用 Ctrl / Alt / ⌘ 组合键或 F1–F24，避开关闭窗口的快捷键。';
        return;
      }
      cancel();
      options.onChange(next);
      hint.textContent = `已设为 ${display(next)}`;
    }, { capture: true, signal: recorder.signal });
    hint.textContent = '请按下新的快捷键；按 Esc 或再次点击取消。';
    render();
  }, { signal: options.signal });
  reset.addEventListener('click', () => { cancel(); options.onChange(DEFAULT_PANEL_SHORTCUT); }, { signal: options.signal });
  window.addEventListener('blur', cancel, { signal: options.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, { signal: options.signal });
  options.signal.addEventListener('abort', cancel, { once: true });
  cancel();
  return {
    root, cancel,
    get recording() { return recorder !== null; },
    sync(next: string) { if (next !== value) { value = next; cancel(); } },
  };
}
