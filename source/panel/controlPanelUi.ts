/** DOM builders shared by the function panel: titled groups, cards and setting rows. */

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let uid = 0;
export const nextId = (prefix: string): string => `control-panel-${prefix}-${++uid}`;

// No xmlns: the purity gate rejects URLs, and the HTML parser places inline <svg> in the SVG namespace.
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
const ICONS = {
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>',
  previous: '<path d="m14.5 6-6 6 6 6"/>',
  next: '<path d="m9.5 6 6 6-6 6"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M5 5v4h4"/>',
} as const;
export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, className = 'control-panel__icon'): HTMLSpanElement => {
  const node = el('span', className);
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `${SVG_OPEN}${ICONS[name]}</svg>`;
  return node;
};

/** Plain button; icon-only buttons need an accessible `label`. */
export const button = (text: string, options: { icon?: IconName; label?: string; className?: string } = {}): HTMLButtonElement => {
  const node = el('button', options.className);
  node.type = 'button';
  if (options.icon) node.append(icon(options.icon));
  if (text) node.append(el('span', undefined, text));
  if (options.label) {
    node.setAttribute('aria-label', options.label);
    node.title = options.label;
  }
  return node;
};

export const press = (target: HTMLButtonElement, on: boolean): void => {
  target.setAttribute(target.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(on));
};

/** `Ctrl+Space` as key caps. */
export const keyChips = (shortcut: string): Node[] =>
  shortcut.split('+').flatMap((key, index) =>
    index === 0 ? [el('kbd', undefined, key)] : [document.createTextNode(' + '), el('kbd', undefined, key)]);

export type RowOptions = {
  label: string;
  hint?: string;
  /** Indented under the setting it depends on. */
  sub?: boolean;
  /** Wider control column for sliders and text fields. */
  wide?: boolean;
};

export type Row<T extends HTMLElement = HTMLElement> = { root: T; label: HTMLElement; hint: HTMLElement | null };

const itemClass = (base: string, options: RowOptions): string =>
  [base, options.sub ? 'control-panel__item--sub' : '', options.wide ? 'control-panel__item--wide' : '']
    .filter(Boolean).join(' ');

const rowText = (options: RowOptions, keyHint?: string) => {
  const text = el('span', 'control-panel__item-text');
  const label = el('span', 'control-panel__item-label');
  label.id = nextId('label');
  label.append(el('span', undefined, options.label));
  if (keyHint) {
    // The switch carries `aria-keyshortcuts`; the key cap is visual only.
    const key = el('kbd', 'control-panel__key', keyHint);
    key.setAttribute('aria-hidden', 'true');
    label.append(key);
  }
  text.append(label);
  let hint: HTMLElement | null = null;
  if (options.hint !== undefined) {
    hint = el('span', 'control-panel__item-hint', options.hint);
    hint.id = nextId('hint');
    text.append(hint);
  }
  return { text, label, hint };
};

const describe = (node: HTMLElement, label: HTMLElement, hint: HTMLElement | null): void => {
  if (!node.hasAttribute('aria-label')) node.setAttribute('aria-labelledby', label.id);
  if (hint && !node.hasAttribute('aria-describedby')) node.setAttribute('aria-describedby', hint.id);
};

/** Label and hint on the left, controls on the right. The first control is named by the row label unless it has its own. */
export function row(options: RowOptions & { controls: HTMLElement[] }): Row {
  const root = el('div', itemClass('control-panel__item', options));
  const { text, label, hint } = rowText(options);
  const control = el('div', 'control-panel__item-control');
  control.append(...options.controls);
  if (options.controls[0]) describe(options.controls[0], label, hint);
  root.append(text, control);
  return { root, label, hint };
}

/** Whole-row switch: label, hint and track form one large target. */
export function switchRow(options: RowOptions & { keyHint?: string }): Row<HTMLButtonElement> {
  const root = el('button', itemClass('control-panel__item control-panel__toggle', options));
  root.type = 'button';
  root.setAttribute('role', 'switch');
  root.setAttribute('aria-checked', 'false');
  if (options.keyHint) root.setAttribute('aria-keyshortcuts', options.keyHint);
  const { text, label, hint } = rowText(options, options.keyHint);
  const track = el('span', 'control-panel__switch');
  track.setAttribute('aria-hidden', 'true');
  root.append(text, track);
  describe(root, label, hint);
  return { root, label, hint };
}

/** One-of-n choice as a group of pressed buttons. */
export function segments<T extends string>(
  label: string,
  items: ReadonlyArray<{ value: T; label: string }>,
  className?: string,
): { root: HTMLElement; buttons: Map<T, HTMLButtonElement> } {
  const root = el('div', className ? `control-panel__segments ${className}` : 'control-panel__segments');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', label);
  const buttons = new Map<T, HTMLButtonElement>();
  for (const item of items) {
    const node = button(item.label);
    node.dataset.value = item.value;
    buttons.set(item.value, node);
    root.append(node);
  }
  return { root, buttons };
}

/** Range input with a live value label; `format` also feeds `aria-valuetext`. */
export function slider(options: {
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  spoken?(value: number): string;
}): { input: HTMLInputElement; value: HTMLElement; render(): void } {
  const input = el('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  const value = el('output', 'control-panel__value');
  value.setAttribute('aria-hidden', 'true');
  const render = (): void => {
    const current = Number(input.value);
    value.textContent = options.format(current);
    input.setAttribute('aria-valuetext', (options.spoken ?? options.format)(current));
    // Filled part of the track; see `.control-panel input[type="range"]`.
    const span = options.max - options.min;
    input.style.setProperty('--fill', `${span > 0 ? ((current - options.min) / span) * 100 : 0}%`);
  };
  return { input, value, render };
}

/** Dims a row's text; its controls are disabled by the caller. */
export const dimRow = (root: HTMLElement, off: boolean): void => {
  root.classList.toggle('is-disabled', off);
};

/** Titled group: rows share one card, with an optional note below. */
export function group(title: string, rows: HTMLElement[], note?: string | HTMLElement): HTMLElement {
  const root = el('section', 'control-panel__group');
  const heading = el('h3', 'control-panel__group-title', title);
  heading.id = nextId('group');
  root.setAttribute('aria-labelledby', heading.id);
  const card = el('div', 'control-panel__card');
  card.append(...rows);
  root.append(heading, card);
  if (note !== undefined) root.append(typeof note === 'string' ? el('p', 'control-panel__note', note) : note);
  return root;
}

/** Note element for `group`, updated by its owner. */
export const note = (text = ''): HTMLParagraphElement => el('p', 'control-panel__note', text);
