import type { LibrarySource } from './host/librarySource.ts';
import type { LatticeSettings } from './types.ts';
import { createControlPanelSettings } from './controlPanelSettings.ts';
import { createControlPanelTabs } from './controlPanelTabs.ts';
import { createControlPanelShortcut } from './controlPanelShortcut.ts';
import { matchesPanelShortcut, panelShortcutAria } from './host/controlPanelShortcut.ts';
import { createControlPanelSpeed } from './controlPanelSpeed.ts';
import { createControlPanelDesktop } from './controlPanelDesktop.ts';
import { button, el, group, icon, keyChips, press, row, segments } from './controlPanelUi.ts';
import type { SpeedControl, DesktopControl } from './host/api.ts';

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

const WALLS: ReadonlyArray<{ value: ControlPanelWall; label: string; description: string }> = [
  { value: 'library', label: '曲库拼贴墙', description: '按歌曲铺满，每页 200 首' },
  { value: 'albums', label: '专辑拼贴墙', description: '按专辑浏览，每页 60 张' },
];
const SOURCES: ReadonlyArray<{ value: LibrarySource; label: string }> = [
  { value: 'local', label: '本地' },
  { value: 'remote', label: '远程' },
];
/** Wall keys from `wall/keyboardNav.ts`; Enter and Space differ per wall. */
const WALL_KEYS = (wall: ControlPanelWall): ReadonlyArray<[string, string]> => [
  ['方向键', '在封面间移动'],
  ['Enter', wall === 'library' ? '展开；再按播放 / 暂停' : '展开；再按播放整张'],
  ['Space', wall === 'library' ? '展开；再按显示 / 隐藏控制' : '展开；再按切换曲目区'],
  ['C', wall === 'library' ? '定位正在播放的歌曲' : '定位正在播放的专辑'],
  ['L / V / T', '关灯 / 暗角 / 叠色'],
  ['Esc', '收起卡片；再按关闭'],
];

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')].filter(
    (node) => node.tabIndex >= 0 && !node.disabled && !node.hidden && !node.closest('[hidden]') && node.getAttribute('aria-hidden') !== 'true',
  );

const wallKeys = (wall: ControlPanelWall): HTMLElement => {
  const list = el('dl', 'control-panel__keys');
  for (const [keys, action] of WALL_KEYS(wall)) {
    const item = el('div', 'control-panel__keys-item');
    const term = el('dt');
    term.append(...keys.split(' / ').flatMap((key, index) =>
      index === 0 ? [el('kbd', undefined, key)] : [document.createTextNode(' '), el('kbd', undefined, key)]));
    item.append(term, el('dd', undefined, action));
    list.append(item);
  }
  return list;
};

/**
 * Function panel: a sidebar of five pages (browse, playback, appearance, lighting, general), each a
 * stack of titled cards. Owns no library data.
 */
export function createControlPanel(
  container: HTMLElement,
  options: {
    wall: ControlPanelWall;
    settings: LatticeSettings;
    search: ControlPanelSearchCopy;
    lyrics?: boolean;
    speed?: SpeedControl;
    desktop?: DesktopControl;
    onLoad: (page: number, search: string, source: LibrarySource) => void;
    onSwitchWall: (target: ControlPanelWall) => void;
    onPatchSettings: (patch: Partial<LatticeSettings>) => void;
  },
): ControlPanel {
  const abort = new AbortController();
  const { signal } = abort;
  const dialog = el('dialog', 'control-panel');
  dialog.setAttribute('aria-labelledby', 'control-panel-title');
  let panelShortcut = options.settings.controlPanelShortcut;
  const wallName = options.wall === 'library' ? '曲库拼贴墙' : '专辑拼贴墙';

  // ---- browse -----------------------------------------------------------------------------------
  const walls = el('div', 'control-panel__walls');
  walls.setAttribute('role', 'group');
  walls.setAttribute('aria-label', '切换拼贴墙');
  const wallButtons = new Map<ControlPanelWall, HTMLButtonElement>();
  for (const item of WALLS) {
    const node = button('', { className: 'control-panel__wall' });
    node.dataset.wall = item.value;
    const text = el('span', 'control-panel__wall-text');
    text.append(el('span', 'control-panel__wall-name', item.label), el('span', 'control-panel__wall-description', item.description));
    const dot = el('span', 'control-panel__wall-dot');
    dot.setAttribute('aria-hidden', 'true');
    node.append(text, dot);
    wallButtons.set(item.value, node);
    walls.append(node);
  }

  const searchField = el('label', 'control-panel__search');
  const search = el('input');
  search.type = 'search';
  search.placeholder = options.search.placeholder;
  search.setAttribute('aria-label', options.search.searchLabel);
  search.maxLength = 160;
  search.spellcheck = false;
  searchField.append(icon('search'), search);
  const sources = segments('曲库来源', SOURCES);
  let source: LibrarySource = 'local';
  const sourceRow = row({ label: '曲库来源', hint: '远程曲库需先在 ECHO 中同步', controls: [sources.root] });
  const status = el('span', 'control-panel__status');
  status.setAttribute('role', 'status');
  const previous = button('上一页', { icon: 'previous' });
  const next = button('');
  next.append(el('span', undefined, '下一页'), icon('next'));
  const refresh = button('刷新', { icon: 'refresh' });
  const pagerButtons = el('div', 'control-panel__pager-buttons');
  pagerButtons.append(previous, next, refresh);
  const pager = el('div', 'control-panel__pager');
  pager.append(status, pagerButtons);
  const searchBody = el('div', 'control-panel__search-body');
  searchBody.append(searchField);
  const browse = [
    group('拼贴墙', [walls]),
    group(options.search.searchLabel, [searchBody, sourceRow.root, pager]),
  ];

  // ---- settings ---------------------------------------------------------------------------------
  const settings = createControlPanelSettings({
    titleLabel: options.wall === 'library' ? '常显歌名' : '常显专辑名',
    lyrics: options.lyrics === true,
    settings: options.settings,
    onPatchSettings: options.onPatchSettings,
    signal,
  });
  const shortcutSetting = createControlPanelShortcut({
    value: panelShortcut,
    onChange: value => options.onPatchSettings({ controlPanelShortcut: value }),
    signal,
  });
  const speed = options.speed ? createControlPanelSpeed(options.speed) : null;
  const desktop = options.desktop ? createControlPanelDesktop(options.desktop, signal) : null;
  const { rows, groups } = settings;

  const tabs = createControlPanelTabs([
    { id: 'browse', label: '浏览', description: '切换拼贴墙，搜索与翻页', sections: browse },
    {
      id: 'playback', label: '播放', description: options.lyrics ? '播放速度、切歌与歌词' : '播放速度与切歌',
      sections: [group('播放', [...(speed ? [speed.root] : []), rows.autoFocus]), groups.lyrics],
    },
    { id: 'appearance', label: '外观', description: '封面、格子尺寸、字体与立体效果', sections: [groups.wall, groups.depth] },
    { id: 'lighting', label: '光影', description: '灯光模式、暗角、关灯与叠色', sections: [groups.light, groups.tint] },
    {
      id: 'general', label: '通用', description: '窗口、桌面墙与快捷键',
      sections: [
        group('窗口', [rows.immersive, ...(desktop ? [desktop.root] : [])]),
        group('快捷键', [shortcutSetting.root, wallKeys(options.wall)], '快捷键只在拼贴墙内生效；墙面按键在功能面板关闭时可用。'),
      ],
    },
  ], signal, category => {
    if (category !== 'general') shortcutSetting.cancel();
    if (dialog.open && category === 'playback') speed?.open();
    else speed?.close();
    if (dialog.open && category === 'general') desktop?.open();
  });

  // ---- layout -----------------------------------------------------------------------------------
  const form = el('form', 'control-panel__form');
  const sidebar = el('div', 'control-panel__sidebar');
  const brand = el('div', 'control-panel__brand');
  const title = el('h2', undefined, '功能面板');
  title.id = 'control-panel-title';
  const wordmark = el('p', 'control-panel__wordmark', 'Lattice');
  wordmark.setAttribute('aria-hidden', 'true');
  brand.append(wordmark, title, el('p', 'control-panel__brand-wall', wallName));
  const footer = el('div', 'control-panel__footer');
  const shortcut = el('span', 'control-panel__shortcut');
  footer.append(el('span', undefined, '设置即时生效'), shortcut);
  sidebar.append(brand, tabs.navigation, footer);
  const main = el('div', 'control-panel__main');
  const header = el('div', 'control-panel__header');
  const dismiss = button('', { icon: 'close', label: '关闭功能面板（Esc）', className: 'control-panel__dismiss' });
  header.append(tabs.heading, dismiss);
  main.append(header, tabs.pages);
  form.append(sidebar, main);
  dialog.append(form);
  container.append(dialog);

  let returnFocus: HTMLElement | null = null;
  let page = 1;
  let hasMore = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = (): void => {
    shortcutSetting.cancel();
    speed?.close();
    dialog.close();
    const target = returnFocus?.isConnected ? returnFocus : document.getElementById('field');
    target?.focus({ preventScroll: true });
    returnFocus = null;
  };

  const load = (target: number): void => {
    clearTimeout(timer);
    options.onLoad(target, search.value.trim(), source);
  };

  const buttons = (): void => {
    previous.disabled = busy || page === 1;
    next.disabled = busy || !hasMore;
    refresh.disabled = busy;
  };

  const syncSource = (): void => {
    for (const [value, node] of sources.buttons) press(node, value === source);
  };

  const syncWall = (): void => {
    for (const [value, node] of wallButtons) {
      const active = value === options.wall;
      press(node, active);
      if (active) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    }
  };

  const syncSettings = (latest: LatticeSettings): void => {
    panelShortcut = latest.controlPanelShortcut;
    shortcutSetting.sync(panelShortcut);
    dialog.setAttribute('aria-keyshortcuts', panelShortcutAria(panelShortcut));
    const field = container.querySelector<HTMLElement>('#field');
    field?.setAttribute('aria-label', wallName);
    field?.setAttribute('aria-keyshortcuts', panelShortcutAria(panelShortcut));
    field?.setAttribute('aria-description', `按 ${panelShortcut.split('+').join(' + ')} 打开功能面板`);
    shortcut.replaceChildren(...keyChips(panelShortcut));
    settings.sync(latest);
    syncWall();
  };

  document.addEventListener('keydown', (event) => {
    if (shortcutSetting.recording || !matchesPanelShortcut(event, panelShortcut)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (!dialog.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    tabs.select('browse');
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

  for (const [value, node] of sources.buttons) {
    node.addEventListener('click', () => {
      if (value === source) return;
      source = value;
      syncSource();
      load(1);
    }, { signal });
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(1), 350);
  }, { signal });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat) load(1);
  }, { signal });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (tabs.selected === 'browse') load(1);
  }, { signal });
  previous.addEventListener('click', () => load(Math.max(1, page - 1)), { signal });
  next.addEventListener('click', () => load(page + 1), { signal });
  refresh.addEventListener('click', () => load(page), { signal });

  for (const [value, node] of wallButtons) {
    node.addEventListener('click', () => {
      if (value !== options.wall) options.onSwitchWall(value);
    }, { signal });
  }

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

  syncSource();
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
        ? `共 ${result.total} ${options.search.unit}`
        : `第 ${page} / ${pages} 页 · 共 ${result.total} ${options.search.unit}`;
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
      speed?.dispose();
      clearTimeout(timer);
      abort.abort();
      dialog.close();
      dialog.remove();
      returnFocus = null;
    },
  };
}
