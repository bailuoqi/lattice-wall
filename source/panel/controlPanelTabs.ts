export type ControlPanelCategory = 'browse' | 'playback' | 'appearance' | 'lighting' | 'general';
type Category = { id: ControlPanelCategory; label: string; description: string; sections: HTMLElement[] };

/** Same breakpoint as `65-control-panel.css`, where the sidebar becomes a top strip. */
const NARROW = '(max-width: 640px)';

/** Accessible local navigation: one mounted page is visible, with a single tab stop in the tablist. */
export function createControlPanelTabs(categories: Category[], signal: AbortSignal, onSelect: (id: ControlPanelCategory) => void) {
  const navigation = document.createElement('div');
  navigation.className = 'control-panel__tabs';
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-label', '功能分类');
  const narrow = window.matchMedia(NARROW);
  const orient = (): void => navigation.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  orient();
  narrow.addEventListener('change', orient, { signal });
  const pages = document.createElement('div');
  pages.className = 'control-panel__pages';
  // Visual page title; the tabpanel is named by its tab and described by the description line.
  const heading = document.createElement('div');
  heading.className = 'control-panel__page-heading';
  const title = document.createElement('p');
  title.className = 'control-panel__page-title';
  title.setAttribute('aria-hidden', 'true');
  const description = document.createElement('p');
  description.className = 'control-panel__page-description';
  const prefix = `control-category-${crypto.randomUUID()}`;
  description.id = `${prefix}-description`;
  heading.append(title, description);
  const entries = categories.map((category, order) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `${prefix}-${category.id}-tab`;
    button.className = 'control-panel__tab';
    button.setAttribute('role', 'tab');
    // Editorial index (01–05); visual only, the tab is named by its label.
    const index = document.createElement('span');
    index.className = 'control-panel__tab-index';
    index.setAttribute('aria-hidden', 'true');
    index.textContent = String(order + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.textContent = category.label;
    button.append(index, label);
    const page = document.createElement('div');
    page.id = `${prefix}-${category.id}`;
    page.className = 'control-panel__page';
    page.dataset.category = category.id;
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', button.id);
    page.setAttribute('aria-describedby', description.id);
    button.setAttribute('aria-controls', page.id);
    page.append(...category.sections);
    navigation.append(button);
    pages.append(page);
    return { ...category, button, page };
  });
  let selected: ControlPanelCategory = 'browse';
  const select = (id: ControlPanelCategory): void => {
    const next = entries.find(entry => entry.id === id);
    if (!next) return;
    if (entries.some(entry => entry.id !== id && entry.page.contains(document.activeElement))) next.button.focus();
    selected = id;
    for (const entry of entries) {
      const active = entry.id === id;
      entry.button.setAttribute('aria-selected', String(active));
      entry.button.tabIndex = active ? 0 : -1;
      entry.page.hidden = !active;
    }
    title.textContent = next.label;
    description.textContent = next.description;
    pages.scrollTop = 0;
    if (narrow.matches) next.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    onSelect(id);
  };
  for (const [index, entry] of entries.entries()) {
    entry.button.addEventListener('click', () => select(entry.id), { signal });
    entry.button.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // Vertical in the sidebar, horizontal on narrow windows: both arrow pairs move.
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      let next: number;
      if (step !== 0) next = (index + step + entries.length) % entries.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = entries.length - 1;
      else return;
      event.preventDefault();
      entries[next]!.button.focus();
      select(entries[next]!.id);
    }, { signal });
  }
  select(selected);
  return { navigation, pages, heading, select, get selected() { return selected; } };
}
