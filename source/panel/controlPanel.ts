import type { LatticeSettings } from './types.ts';
import { createControlPanelSettings } from './controlPanelSettings.ts';

export type ControlPanelWall = 'library' | 'albums';

export type ControlPanelSearchCopy = {
  placeholder: string;
  searchLabel: string;
  unit: string;
};

export type ControlPanel = {
  loading(page: number): void;
  update(result: EchoWorkshopPage<unknown>): void;
  error(): void;
  refresh(): void;
  syncSettings(settings: LatticeSettings): void;
  dispose(): void;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')].filter(
    (node) => !node.disabled && !node.hidden && !node.closest('[hidden]') && node.getAttribute('aria-hidden') !== 'true',
  );

/**
 * Ctrl+Space function panel: wall switch, per-wall search + paging, and Folia-style Lattice settings.
 * Owns no library data.
 */
export function createControlPanel(
  container: HTMLElement,
  options: {
    wall: ControlPanelWall;
    settings: LatticeSettings;
    search: ControlPanelSearchCopy;
    lyrics?: boolean;
    onLoad: (page: number, search: string) => void;
    onSwitchWall: (target: ControlPanelWall) => void;
    onPatchSettings: (patch: Partial<LatticeSettings>) => void;
  },
): ControlPanel {
  const abort = new AbortController();
  const { signal } = abort;
  const dialog = el('dialog', 'control-panel');
  dialog.setAttribute('aria-labelledby', 'control-panel-title');
  dialog.setAttribute('aria-keyshortcuts', 'Control+Space');

  const form = el('form', 'control-panel__form');
  const header = el('div', 'control-panel__header');
  const title = el('h2', undefined, '功能面板');
  title.id = 'control-panel-title';
  const dismiss = el('button', undefined, 'Esc');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', '关闭功能面板');
  header.append(title, dismiss);

  const wallSection = el('section', 'control-panel__section');
  wallSection.append(el('h3', 'control-panel__label', '拼贴墙'));
  const wallRow = el('div', 'control-panel__options');
  const libraryWall = el('button', undefined, '曲库拼贴墙');
  libraryWall.type = 'button';
  libraryWall.dataset.wall = 'library';
  const albumWall = el('button', undefined, '专辑拼贴墙');
  albumWall.type = 'button';
  albumWall.dataset.wall = 'albums';
  wallRow.append(libraryWall, albumWall);
  wallSection.append(wallRow);

  const searchSection = el('section', 'control-panel__section');
  searchSection.append(el('h3', 'control-panel__label', options.search.searchLabel));
  const search = el('input');
  search.type = 'search';
  search.placeholder = options.search.placeholder;
  search.setAttribute('aria-label', options.search.searchLabel);
  search.maxLength = 160;
  const previous = el('button', undefined, '上一页');
  previous.type = 'button';
  const next = el('button', undefined, '下一页');
  next.type = 'button';
  const status = el('span', 'control-panel__status');
  status.setAttribute('role', 'status');
  const refresh = el('button', undefined, '刷新');
  refresh.type = 'button';
  const pager = el('div', 'control-panel__pager');
  pager.append(previous, status, next, refresh);
  searchSection.append(search, pager);

  const appearance = createControlPanelSettings({
    lyrics: options.lyrics === true,
    settings: options.settings,
    onPatchSettings: options.onPatchSettings,
    signal,
  });

  form.append(header, wallSection, searchSection, appearance.root);
  dialog.append(form);
  container.append(dialog);

  let returnFocus: HTMLElement | null = null;
  let page = 1;
  let hasMore = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = (): void => {
    dialog.close();
    const target = returnFocus?.isConnected ? returnFocus : document.getElementById('field');
    target?.focus({ preventScroll: true });
    returnFocus = null;
  };

  const load = (target: number): void => {
    clearTimeout(timer);
    options.onLoad(target, search.value.trim());
  };

  const buttons = (): void => {
    previous.disabled = busy || page === 1;
    next.disabled = busy || !hasMore;
    refresh.disabled = busy;
  };

  const syncWall = (): void => {
    libraryWall.setAttribute('aria-pressed', String(options.wall === 'library'));
    albumWall.setAttribute('aria-pressed', String(options.wall === 'albums'));
    if (options.wall === 'library') {
      libraryWall.setAttribute('aria-current', 'true');
      albumWall.removeAttribute('aria-current');
    } else {
      albumWall.setAttribute('aria-current', 'true');
      libraryWall.removeAttribute('aria-current');
    }
  };

  const syncSettings = (next: LatticeSettings): void => {
    appearance.sync(next);
    syncWall();
  };

  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || event.isComposing
      || (event.code !== 'Space' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (!dialog.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    search.focus();
    search.select();
  }, { signal, capture: true });

  dismiss.addEventListener('click', close, { signal });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, { signal });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) close();
  }, { signal });

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(1), 350);
  }, { signal });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(1);
  }, { signal });
  previous.addEventListener('click', () => load(Math.max(1, page - 1)), { signal });
  next.addEventListener('click', () => load(page + 1), { signal });
  refresh.addEventListener('click', () => load(page), { signal });

  const onWallClick = (target: ControlPanelWall): void => {
    if (target === options.wall) return;
    options.onSwitchWall(target);
  };
  libraryWall.addEventListener('click', () => onWallClick('library'), { signal });
  albumWall.addEventListener('click', () => onWallClick('albums'), { signal });

  dialog.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab') {
      const nodes = focusables(dialog);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      close();
    }
    event.stopPropagation();
  }, { signal });

  syncSettings(options.settings);
  buttons();

  return {
    loading(target) {
      page = target;
      busy = true;
      form.setAttribute('aria-busy', 'true');
      status.textContent = '正在加载…';
      buttons();
    },
    update(result) {
      page = result.page;
      hasMore = result.hasMore;
      busy = false;
      form.removeAttribute('aria-busy');
      const pages = Math.max(1, Math.ceil(result.total / Math.max(1, result.pageSize)));
      status.textContent = pages <= 1
        ? `${result.total} ${options.search.unit}`
        : `${page} / ${pages} · ${result.total} ${options.search.unit}`;
      buttons();
    },
    error() {
      busy = false;
      form.removeAttribute('aria-busy');
      status.textContent = '加载失败，请刷新重试';
      buttons();
    },
    refresh() {
      if (!busy) load(page);
    },
    syncSettings,
    dispose() {
      clearTimeout(timer);
      abort.abort();
      dialog.close();
      dialog.remove();
      returnFocus = null;
    },
  };
}
