import type { CellSizeId, LatticeSettings, LightingMode, TintGradient } from './types.ts';
import { controlPanelSettingLocks, sanitizeUiFont } from './host/settings.ts';
import { createControlPanelHudTilt } from './controlPanelHudTilt.ts';
import { dimRow, el, group, note, press, row, segments, slider, switchRow } from './controlPanelUi.ts';

const FONT_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '系统默认' },
  { value: 'Microsoft YaHei, PingFang SC, sans-serif', label: '微软雅黑' },
  { value: 'SimSun, Songti SC, serif', label: '宋体' },
  { value: 'SimHei, Heiti SC, sans-serif', label: '黑体' },
  { value: 'KaiTi, Kaiti SC, serif', label: '楷体' },
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Georgia, Times New Roman, serif', label: 'Georgia' },
];

const CUSTOM_FONT = '__custom__';
const CELL_SIZES: ReadonlyArray<{ value: CellSizeId; label: string }> = [
  { value: 'S', label: '小' },
  { value: 'M', label: '中' },
  { value: 'L', label: '大' },
];
const LIGHTING_MODES: ReadonlyArray<{ value: LightingMode; label: string }> = [
  { value: 'spotlight', label: '聚光灯' },
  { value: 'daytime', label: '白天' },
];
const TINT_GRADIENTS: ReadonlyArray<{ value: TintGradient; label: string }> = [
  { value: 'none', label: '纯色' },
  { value: 'diagonal', label: '斜向渐变' },
  { value: 'vertical', label: '竖向渐变' },
];

const option = (value: string, label: string): HTMLOptionElement => {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
};

const presetOf = (font: string): string =>
  FONT_PRESETS.some((item) => item.value === font) ? font : CUSTOM_FONT;

type Toggle = 'immersive' | 'autoFocus' | 'fisheye' | 'pointer3d' | 'vignette' | 'lightsOut' | 'posterTint'
  | 'posterTintCustom' | 'showTitles' | 'showLyrics' | 'showTranslation';

/**
 * Lattice settings as titled groups. Rows that share a group with other modules (auto-focus next to
 * playback speed, immersive next to the desktop wall) are returned on their own.
 */
export function createControlPanelSettings(
  options: {
    titleLabel: string;
    lyrics: boolean;
    settings: LatticeSettings;
    onPatchSettings: (patch: Partial<LatticeSettings>) => void;
    signal: AbortSignal;
  },
) {
  const { signal } = options;
  let settings = options.settings;
  const patch = (next: Partial<LatticeSettings>): void => options.onPatchSettings(next);
  const switches = new Map<Toggle, HTMLButtonElement>();
  const toggle = (key: Toggle, item: { root: HTMLButtonElement }): HTMLButtonElement => {
    switches.set(key, item.root);
    item.root.addEventListener('click', () => patch({ [key]: !settings[key] }), { signal });
    return item.root;
  };

  // ---- playback ---------------------------------------------------------------------------------
  const autoFocus = toggle('autoFocus', switchRow({ label: '切歌自动聚焦', hint: '当前曲变化时，镜头飞到当前曲并展开' }));
  const showLyrics = toggle('showLyrics', switchRow({ label: '当前曲歌词', hint: '展开当前曲时显示逐字歌词' }));
  const showTranslation = toggle('showTranslation', switchRow({ label: '翻译行', hint: '在歌词下方显示翻译', sub: true }));
  const lyrics = group('歌词', [showLyrics, showTranslation], '只作用于曲库墙展开的当前曲。');
  lyrics.hidden = !options.lyrics;

  // ---- appearance -------------------------------------------------------------------------------
  const showTitles = toggle('showTitles', switchRow({ label: options.titleLabel, hint: '在封面上始终显示标题' }));
  const cells = segments('格子尺寸', CELL_SIZES);
  const cellRow = row({ label: '格子尺寸', hint: '封面的基础大小', controls: [cells.root] });
  const font = el('select');
  for (const item of FONT_PRESETS) font.append(option(item.value, item.label));
  font.append(option(CUSTOM_FONT, '自定义…'));
  const fontRow = row({ label: '界面字体', controls: [font] });
  const customFont = el('input');
  customFont.type = 'text';
  customFont.maxLength = 80;
  customFont.placeholder = '例如 Cascadia Code';
  customFont.spellcheck = false;
  const customFontRow = row({ label: '字体名称', hint: '回车或移开焦点后应用', sub: true, wide: true, controls: [customFont] });
  const wall = group('墙面', [showTitles, cellRow.root, fontRow.root, customFontRow.root]);

  const fisheye = toggle('fisheye', switchRow({ label: '鱼眼模式', hint: '墙面四周向屏幕内弯曲，营造镜头感' }));
  const pointer3d = toggle('pointer3d', switchRow({ label: 'HUD 悬浮视差', hint: '随指针悬浮倾斜，封面与文字分层移动' }));
  const hudTilt = createControlPanelHudTilt(options);
  const depth = group('立体效果', [fisheye, pointer3d, hudTilt.root], '两面墙共享，可叠加使用；拖动或悬停控件时保持稳定，减少动态效果时暂停视差。');

  // ---- lighting ---------------------------------------------------------------------------------
  const lighting = segments('灯光模式', LIGHTING_MODES);
  const lightingRow = row({ label: '灯光模式', hint: '', controls: [lighting.root] });
  // The mode gates the three effects below it, so they share one card.
  const vignette = toggle('vignette', switchRow({ label: '边缘暗角', hint: '压暗墙面四周', keyHint: 'V' }));
  const lightsOut = toggle('lightsOut', switchRow({ label: '关灯', hint: '调暗当前曲以外的封面', keyHint: 'L' }));
  const posterTint = toggle('posterTint', switchRow({ label: '非活动海报叠色', hint: '给当前曲以外的封面覆盖一层颜色', keyHint: 'T' }));
  const shadeNote = note();
  const light = group('灯光', [lightingRow.root, vignette, lightsOut, posterTint], shadeNote);

  const gradients = segments('叠色方式', TINT_GRADIENTS);
  const gradientRow = row({ label: '叠色方式', controls: [gradients.root] });
  const custom = toggle('posterTintCustom', switchRow({ label: '自定义颜色', hint: '关闭时叠色为纯黑' }));
  const color = el('input');
  color.type = 'color';
  const colorValue = el('span', 'control-panel__value control-panel__value--code');
  colorValue.setAttribute('aria-hidden', 'true');
  const colorRow = row({ label: '叠色颜色', sub: true, controls: [color, colorValue] });
  const intensity = slider({ min: 0, max: 1, step: 0.05, format: value => `${Math.round(value * 100)}%` });
  const intensityRow = row({ label: '叠色强度', wide: true, controls: [intensity.input, intensity.value] });
  const tintNote = note();
  const tint = group('叠色', [gradientRow.root, custom, colorRow.root, intensityRow.root], tintNote);

  // ---- general ----------------------------------------------------------------------------------
  const immersive = toggle('immersive', switchRow({ label: '打开时全屏沉浸', hint: '进入时最大化 ECHO 窗口并隐藏标题栏，Esc 退出' }));

  let customPending = false;
  let shadeTimer: ReturnType<typeof setTimeout> | undefined;

  const sync = (next: LatticeSettings): void => {
    settings = next;
    const locks = controlPanelSettingLocks(next);
    for (const [key, node] of switches) press(node, next[key]);
    hudTilt.sync(next);
    for (const [size, node] of cells.buttons) press(node, next.cellSize === size);
    for (const [mode, node] of lighting.buttons) press(node, next.lightingMode === mode);
    lightingRow.hint!.textContent = locks.spotlight
      ? '突出当前封面，周围封面带有光影层次'
      : '所有封面均匀照亮，光影效果暂停';

    for (const node of [vignette, lightsOut, posterTint]) {
      node.disabled = !locks.spotlight;
      dimRow(node, !locks.spotlight);
    }
    shadeNote.textContent = locks.spotlight
      ? '在墙面上按 V / L / T 也能快速切换。'
      : '白天模式下光影效果暂停；在墙面上按 V / L / T 会切回聚光灯。';

    for (const [gradient, node] of gradients.buttons) {
      press(node, next.posterTintGradient === gradient);
      node.disabled = !locks.tint;
    }
    custom.disabled = !locks.tint;
    color.disabled = !locks.customColor;
    intensity.input.disabled = !locks.tint;
    dimRow(gradientRow.root, !locks.tint);
    dimRow(custom, !locks.tint);
    dimRow(colorRow.root, !locks.customColor);
    dimRow(intensityRow.root, !locks.tint);
    tintNote.hidden = locks.tint;
    tintNote.textContent = locks.spotlight ? '开启「非活动海报叠色」后可调。' : '白天模式下叠色暂停。';
    if (color.value !== next.posterTintColor) color.value = next.posterTintColor;
    colorValue.textContent = next.posterTintColor.toUpperCase();
    const intensitySetting = String(next.posterTintIntensity);
    if (intensity.input.value !== intensitySetting) intensity.input.value = intensitySetting;
    intensity.render();

    const preset = customPending ? CUSTOM_FONT : presetOf(next.uiFont);
    font.value = preset;
    customFontRow.root.hidden = preset !== CUSTOM_FONT;
    if (preset === CUSTOM_FONT && document.activeElement !== customFont) customFont.value = FONT_PRESETS.some(item => item.value === next.uiFont) ? '' : next.uiFont;

    showTranslation.disabled = !next.showLyrics;
    dimRow(showTranslation, !next.showLyrics);
  };

  for (const [size, node] of cells.buttons) {
    node.addEventListener('click', () => {
      if (settings.cellSize !== size) patch({ cellSize: size });
    }, { signal });
  }
  for (const [mode, node] of lighting.buttons) {
    node.addEventListener('click', () => {
      if (settings.lightingMode !== mode) patch({ lightingMode: mode });
    }, { signal });
  }
  for (const [gradient, node] of gradients.buttons) {
    node.addEventListener('click', () => {
      if (settings.posterTintGradient !== gradient) patch({ posterTintGradient: gradient });
    }, { signal });
  }
  color.addEventListener('input', () => {
    const value = color.value.toLowerCase();
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    colorValue.textContent = value.toUpperCase();
    patch({ posterTintColor: value });
  }, { signal });
  const commitIntensity = (): void => {
    const value = Number(intensity.input.value);
    if (!Number.isFinite(value)) return;
    patch({ posterTintIntensity: Math.min(1, Math.max(0, value)) });
  };
  intensity.input.addEventListener('input', () => {
    intensity.render();
    clearTimeout(shadeTimer);
    shadeTimer = setTimeout(commitIntensity, 80);
  }, { signal });
  intensity.input.addEventListener('change', () => {
    clearTimeout(shadeTimer);
    commitIntensity();
  }, { signal });
  font.addEventListener('change', () => {
    if (font.value === CUSTOM_FONT) {
      customPending = true;
      customFontRow.root.hidden = false;
      customFont.focus();
      return;
    }
    customPending = false;
    customFontRow.root.hidden = true;
    customFont.value = '';
    patch({ uiFont: font.value });
  }, { signal });
  customFont.addEventListener('change', () => {
    patch({ uiFont: sanitizeUiFont(customFont.value) });
  }, { signal });
  customFont.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat) patch({ uiFont: sanitizeUiFont(customFont.value) });
  }, { signal });
  signal.addEventListener('abort', () => clearTimeout(shadeTimer), { once: true });

  sync(settings);
  return {
    rows: { autoFocus, immersive },
    groups: { lyrics, wall, depth, light, tint },
    sync,
  };
}
