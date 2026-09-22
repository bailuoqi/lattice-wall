import type { CellSizeId, LatticeSettings, LightingMode } from './types.ts';
import { controlPanelSettingLocks, sanitizeUiFont } from './host/settings.ts';

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

const option = (value: string, label: string): HTMLOptionElement => {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
};

const press = (button: HTMLButtonElement, on: boolean): void => {
  button.setAttribute('aria-pressed', String(on));
};

const presetOf = (font: string): string =>
  FONT_PRESETS.some((item) => item.value === font) ? font : CUSTOM_FONT;

/**
 * Folia-style Lattice settings: auto-focus, vignette, poster tint + custom colour/intensity,
 * plus Lattice extras already declared in the plugin manifest.
 */
export function createControlPanelSettings(
  options: {
    lyrics: boolean;
    settings: LatticeSettings;
    onPatchSettings: (patch: Partial<LatticeSettings>) => void;
    signal: AbortSignal;
  },
): { root: HTMLElement; sync(settings: LatticeSettings): void } {
  const { signal } = options;
  const root = el('div', 'control-panel__settings');
  let settings = options.settings;

  const behavior = el('section', 'control-panel__section');
  behavior.append(el('h3', 'control-panel__label', '行为'));
  const immersive = el('button', undefined, '打开时全屏沉浸');
  immersive.type = 'button';
  const autoFocus = el('button', undefined, '切歌自动聚焦');
  autoFocus.type = 'button';
  const behaviorRow = el('div', 'control-panel__options');
  behaviorRow.append(immersive, autoFocus);
  behavior.append(behaviorRow);

  const cellSection = el('section', 'control-panel__section');
  cellSection.append(el('h3', 'control-panel__label', '格子尺寸'));
  const cellRow = el('div', 'control-panel__options');
  const cells = new Map<CellSizeId, HTMLButtonElement>();
  for (const item of CELL_SIZES) {
    const button = el('button', undefined, item.label);
    button.type = 'button';
    button.dataset.cell = item.value;
    cells.set(item.value, button);
    cellRow.append(button);
  }
  cellSection.append(cellRow);

  const light = el('section', 'control-panel__section');
  light.append(el('h3', 'control-panel__label', '封面灯光'));
  const lightRow = el('div', 'control-panel__options');
  const spotlight = el('button', undefined, '聚光灯');
  spotlight.type = 'button';
  const daytime = el('button', undefined, '白天');
  daytime.type = 'button';
  lightRow.append(spotlight, daytime);
  const lightHint = el('p', 'control-panel__hint');
  const shadeLabel = el('h3', 'control-panel__label', '聚光灯细节');
  const shadeRow = el('div', 'control-panel__options');
  const vignette = el('button', undefined, '边缘暗角');
  vignette.type = 'button';
  const lightsOut = el('button', undefined, '关灯');
  lightsOut.type = 'button';
  const posterTint = el('button', undefined, '非活动海报叠色');
  posterTint.type = 'button';
  shadeRow.append(vignette, lightsOut, posterTint);
  const tintLabel = el('h3', 'control-panel__label', '叠色细节');
  const tintRow = el('div', 'control-panel__row');
  const custom = el('button', undefined, '使用自定义叠色');
  custom.type = 'button';
  const color = el('input');
  color.type = 'color';
  color.setAttribute('aria-label', '自定义叠色');
  const intensityLabel = el('label', 'control-panel__field-label', '叠色强度');
  const intensity = el('input');
  intensity.type = 'range';
  intensity.min = '0';
  intensity.max = '1';
  intensity.step = '0.05';
  intensity.setAttribute('aria-label', '叠色强度');
  tintRow.append(custom, color, intensityLabel, intensity);
  const tintHint = el('p', 'control-panel__hint');
  light.append(lightRow, lightHint, shadeLabel, shadeRow, tintLabel, tintRow, tintHint);

  const fontSection = el('section', 'control-panel__section');
  fontSection.append(el('h3', 'control-panel__label', '界面字体'));
  const font = el('select');
  font.setAttribute('aria-label', '界面字体');
  for (const item of FONT_PRESETS) font.append(option(item.value, item.label));
  font.append(option(CUSTOM_FONT, '自定义…'));
  const customFont = el('input');
  customFont.type = 'text';
  customFont.maxLength = 80;
  customFont.placeholder = '输入字体名，例如 Cascadia Code';
  customFont.setAttribute('aria-label', '自定义字体');
  fontSection.append(font, customFont);

  const lyrics = el('section', 'control-panel__section');
  lyrics.hidden = !options.lyrics;
  lyrics.append(el('h3', 'control-panel__label', '歌词'));
  const lyricsRow = el('div', 'control-panel__options');
  const showLyrics = el('button', undefined, '当前曲歌词');
  showLyrics.type = 'button';
  const showTranslation = el('button', undefined, '翻译行');
  showTranslation.type = 'button';
  lyricsRow.append(showLyrics, showTranslation);
  lyrics.append(lyricsRow, el('p', 'control-panel__hint', '只作用于曲库墙展开的当前曲。'));

  root.append(behavior, cellSection, light, fontSection, lyrics);

  let shadeTimer: ReturnType<typeof setTimeout> | undefined;

  const disable = (node: HTMLButtonElement | HTMLInputElement, off: boolean): void => {
    node.disabled = off;
  };

  const sync = (next: LatticeSettings): void => {
    settings = next;
    const locks = controlPanelSettingLocks(next);
    press(immersive, next.immersive);
    press(autoFocus, next.autoFocus);
    for (const [size, button] of cells) press(button, next.cellSize === size);
    press(spotlight, next.lightingMode === 'spotlight');
    press(daytime, next.lightingMode === 'daytime');
    lightHint.textContent = locks.spotlight
      ? '未选中封面保留边缘暗角、关灯与非活动海报叠色。'
      : '所有封面一样亮；暗角、关灯和叠色只保存在设置里，白天时不生效。';
    press(vignette, next.vignette);
    press(lightsOut, next.lightsOut);
    press(posterTint, next.posterTint);
    press(custom, next.posterTintCustom);
    disable(vignette, !locks.spotlight);
    disable(lightsOut, !locks.spotlight);
    disable(posterTint, !locks.spotlight);
    disable(custom, !locks.tint);
    disable(color, !locks.customColor);
    disable(intensity, !locks.tint);
    shadeRow.classList.toggle('is-disabled', !locks.spotlight);
    tintRow.classList.toggle('is-disabled', !locks.tint);
    if (color.value !== next.posterTintColor) color.value = next.posterTintColor;
    const intensityValue = String(next.posterTintIntensity);
    if (intensity.value !== intensityValue) intensity.value = intensityValue;
    tintHint.textContent = next.posterTintCustom
      ? '叠色使用所选颜色。'
      : '关闭自定义时叠色保持纯黑。';
    const preset = presetOf(next.uiFont);
    font.value = preset;
    customFont.hidden = preset !== CUSTOM_FONT;
    customFont.value = preset === CUSTOM_FONT ? next.uiFont : '';
    press(showLyrics, next.showLyrics);
    press(showTranslation, next.showTranslation);
    disable(showTranslation, !next.showLyrics);
  };

  const patch = (next: Partial<LatticeSettings>): void => options.onPatchSettings(next);
  const toggle = (key: 'immersive' | 'autoFocus' | 'vignette' | 'lightsOut' | 'posterTint' | 'posterTintCustom' | 'showLyrics' | 'showTranslation'): void => {
    patch({ [key]: !settings[key] });
  };

  immersive.addEventListener('click', () => toggle('immersive'), { signal });
  autoFocus.addEventListener('click', () => toggle('autoFocus'), { signal });
  for (const [size, button] of cells) {
    button.addEventListener('click', () => {
      if (settings.cellSize !== size) patch({ cellSize: size });
    }, { signal });
  }
  const onLighting = (mode: LightingMode): void => {
    if (mode !== settings.lightingMode) patch({ lightingMode: mode });
  };
  spotlight.addEventListener('click', () => onLighting('spotlight'), { signal });
  daytime.addEventListener('click', () => onLighting('daytime'), { signal });
  vignette.addEventListener('click', () => toggle('vignette'), { signal });
  lightsOut.addEventListener('click', () => toggle('lightsOut'), { signal });
  posterTint.addEventListener('click', () => toggle('posterTint'), { signal });
  custom.addEventListener('click', () => toggle('posterTintCustom'), { signal });
  color.addEventListener('input', () => {
    const value = color.value.toLowerCase();
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    patch({ posterTintColor: value });
  }, { signal });
  const commitIntensity = (): void => {
    const value = Number(intensity.value);
    if (!Number.isFinite(value)) return;
    patch({ posterTintIntensity: Math.min(1, Math.max(0, value)) });
  };
  intensity.addEventListener('input', () => {
    clearTimeout(shadeTimer);
    shadeTimer = setTimeout(commitIntensity, 80);
  }, { signal });
  intensity.addEventListener('change', () => {
    clearTimeout(shadeTimer);
    commitIntensity();
  }, { signal });
  font.addEventListener('change', () => {
    if (font.value === CUSTOM_FONT) {
      customFont.hidden = false;
      customFont.focus();
      return;
    }
    customFont.hidden = true;
    customFont.value = '';
    patch({ uiFont: font.value });
  }, { signal });
  customFont.addEventListener('change', () => {
    patch({ uiFont: sanitizeUiFont(customFont.value) });
  }, { signal });
  showLyrics.addEventListener('click', () => toggle('showLyrics'), { signal });
  showTranslation.addEventListener('click', () => toggle('showTranslation'), { signal });
  signal.addEventListener('abort', () => clearTimeout(shadeTimer), { once: true });

  sync(settings);
  return { root, sync };
}
