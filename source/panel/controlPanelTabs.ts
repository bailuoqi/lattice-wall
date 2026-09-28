export type ControlPanelCategory = 'browse' | 'playback' | 'appearance' | 'lighting';
type Category = { id: ControlPanelCategory; label: string; sections: HTMLElement[] };

/** Accessible local navigation: one mounted page is visible, with a single tab stop in the tablist. */
export function createControlPanelTabs(categories: Category[], signal: AbortSignal, onSelect: (id: ControlPanelCategory) => void) {
  const navigation = document.createElement('div');
  navigation.className = 'control-panel__tabs';
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-label', '功能分类');
  const pages = document.createElement('div');
  pages.className = 'control-panel__pages';
  const prefix = `control-category-${crypto.randomUUID()}`;
  const entries = categories.map(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `${prefix}-${category.id}-tab`;
    button.textContent = category.label;
    button.setAttribute('role', 'tab');
    const page = document.createElement('div');
    page.id = `${prefix}-${category.id}`;
    page.className = 'control-panel__page';
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', button.id);
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
    pages.scrollTop = 0;
    onSelect(id);
  };
  for (const [index, entry] of entries.entries()) {
    entry.button.addEventListener('click', () => select(entry.id), { signal });
    entry.button.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      let next: number;
      if (event.key === 'ArrowRight') next = (index + 1) % entries.length;
      else if (event.key === 'ArrowLeft') next = (index + entries.length - 1) % entries.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = entries.length - 1;
      else return;
      event.preventDefault();
      entries[next]!.button.focus();
      select(entries[next]!.id);
    }, { signal });
  }
  select(selected);
  return { navigation, pages, select, get selected() { return selected; } };
}
