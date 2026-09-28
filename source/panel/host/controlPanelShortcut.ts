/** Panel-local shortcuts. No desktop/global shortcut registration or host utilities. */
export const DEFAULT_PANEL_SHORTCUT = 'Ctrl+Space';
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Command'];
const RESERVED = new Set(['Alt+F4', 'Ctrl+W', 'Command+W', 'Command+Q']);
const NAMED: Record<string, string> = {
  space: 'Space', enter: 'Enter', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down',
  left: 'Left', right: 'Right', up: 'Up', down: 'Down', plus: 'Plus',
};
const ALIASES: Record<string, string> = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', command: 'Command', meta: 'Command' };

export function normalizePanelShortcut(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const parts = value.trim().split('+').map(part => part.trim());
  const rawKey = parts.pop() ?? '';
  const key = NAMED[rawKey.toLowerCase()] ?? rawKey.toUpperCase();
  const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!functionKey && !Object.values(NAMED).includes(key) && !/^[A-Z0-9,./;\[\]'`\\=\-]$/.test(key)) return null;
  const modifiers = parts.map(part => ALIASES[part.toLowerCase()]);
  if (modifiers.some(modifier => !modifier) || new Set(modifiers).size !== modifiers.length) return null;
  if (!functionKey && !modifiers.some(modifier => modifier !== 'Shift')) return null;
  const result = [...MODIFIERS.filter(modifier => modifiers.includes(modifier)), key].join('+');
  return RESERVED.has(result) ? null : result;
}

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return null;
  const key = event.code === 'Space' ? 'Space'
    : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
    : event.key === '+' ? 'Plus' : event.key;
  return normalizePanelShortcut([
    ...(event.ctrlKey ? ['Ctrl'] : []), ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []), ...(event.metaKey ? ['Command'] : []), key,
  ].join('+'));
}

export function matchesPanelShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return !event.defaultPrevented && shortcutFromEvent(event) === shortcut;
}

export function panelShortcutAria(shortcut: string): string {
  return shortcut.split('+').map(key => key === 'Ctrl' ? 'Control' : key === 'Command' ? 'Meta' : key).join('+');
}
