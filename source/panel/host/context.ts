export const applyContext = (context: EchoWorkshopUiContext): void => {
  const root = document.documentElement;
  root.dataset.colorScheme = context.colorScheme;
  document.body.dataset.colorScheme = context.colorScheme;
  document.body.dataset.reducedMotion = String(context.reducedMotion);
  root.lang = context.locale || 'zh-CN';
  root.dir = context.direction;
  const tokens: Array<[string, string]> = [
    ['--host-accent', context.appearance.accent],
    ['--host-accent-text', context.appearance.accentText],
    ['--host-app-bg', context.appearance.appBg],
    ['--host-text', context.appearance.text],
    ['--host-muted', context.appearance.muted],
    ['--host-panel', context.appearance.panel],
    ['--host-border', context.appearance.border],
    ['--host-player', context.appearance.player],
  ];
  for (const [name, value] of tokens) {
    if (typeof value === 'string' && value) root.style.setProperty(name, value);
  }
};

