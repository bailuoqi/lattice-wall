import type { CellSizeId, LatticeSettings, LightingMode, Metrics, SettingValues, WallVisualOptions } from '../types.ts';

/** Runtime key → manifest setting id (`contributes.settings[].id`, kebab-case). */
export const SETTING_IDS: Record<keyof LatticeSettings, string> = {
  immersive: 'immersive',
  autoFocus: 'auto-focus',
  lightingMode: 'lighting-mode',
  vignette: 'vignette',
  lightsOut: 'lights-out',
  posterTint: 'poster-tint',
  posterTintCustom: 'poster-tint-custom',
  posterTintColor: 'poster-tint-color',
  posterTintIntensity: 'poster-tint-intensity',
  cellSize: 'cell-size',
  showLyrics: 'show-lyrics',
  showTranslation: 'show-translation',
  uiFont: 'ui-font',
};

export const DEFAULT_SETTINGS: LatticeSettings = {
  immersive: true,
  autoFocus: true,
  lightingMode: 'spotlight',
  vignette: true,
  lightsOut: false,
  posterTint: true,
  posterTintCustom: false,
  posterTintColor: '#000000',
  posterTintIntensity: 0.5,
  cellSize: 'M',
  showLyrics: true,
  showTranslation: true,
  uiFont: '',
};

/** Neutral cover shading, independent of the host theme. */
export const FALLBACK_TINT = '#000000';

const CELL_SIDES: Record<CellSizeId, number> = { S: 104, M: 128, L: 152 };
const CELL_GAP = 8;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FONT_UNSAFE = /url\s*\(|expression\s*\(|[@;{}\\]|<\/?/i;
const FONT_SAFE = /^[\w\s\-"',\u4e00-\u9fff]+$/u;
const FONT_MAX = 80;

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const isCellSize = (value: unknown): value is CellSizeId => value === 'S' || value === 'M' || value === 'L';

export const isLightingMode = (value: unknown): value is LightingMode => value === 'spotlight' || value === 'daytime';

/** Drop CSS injection and keep a short font-family stack. */
export function sanitizeUiFont(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, FONT_MAX);
  if (!trimmed || FONT_UNSAFE.test(trimmed) || !FONT_SAFE.test(trimmed)) return '';
  return trimmed;
}

export function resolveSettings(values: SettingValues): LatticeSettings {
  const source: SettingValues = typeof values === 'object' && values !== null ? values : {};
  const read = (key: keyof LatticeSettings): unknown => source[SETTING_IDS[key]];

  const color = read('posterTintColor');
  const intensity = read('posterTintIntensity');
  const cellSize = read('cellSize');
  const lighting = read('lightingMode');

  return {
    immersive: bool(read('immersive'), DEFAULT_SETTINGS.immersive),
    autoFocus: bool(read('autoFocus'), DEFAULT_SETTINGS.autoFocus),
    lightingMode: isLightingMode(lighting) ? lighting : DEFAULT_SETTINGS.lightingMode,
    vignette: bool(read('vignette'), DEFAULT_SETTINGS.vignette),
    lightsOut: bool(read('lightsOut'), DEFAULT_SETTINGS.lightsOut),
    posterTint: bool(read('posterTint'), DEFAULT_SETTINGS.posterTint),
    posterTintCustom: bool(read('posterTintCustom'), DEFAULT_SETTINGS.posterTintCustom),
    posterTintColor: typeof color === 'string' && HEX_COLOR.test(color) ? color.toLowerCase() : DEFAULT_SETTINGS.posterTintColor,
    posterTintIntensity: typeof intensity === 'number' && Number.isFinite(intensity)
      ? Math.min(1, Math.max(0, intensity))
      : DEFAULT_SETTINGS.posterTintIntensity,
    cellSize: isCellSize(cellSize) ? cellSize : DEFAULT_SETTINGS.cellSize,
    showLyrics: bool(read('showLyrics'), DEFAULT_SETTINGS.showLyrics),
    showTranslation: bool(read('showTranslation'), DEFAULT_SETTINGS.showTranslation),
    uiFont: sanitizeUiFont(read('uiFont')),
  };
}

export function cellMetricsFor(size: CellSizeId): Metrics {
  return { cell: CELL_SIDES[size] ?? CELL_SIDES.M, gap: CELL_GAP };
}

/** Wall zoom. Narrower viewports pull back further so more posters stay on screen. */
export function wallOverviewScale(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0.6;
  if (viewportWidth < 720) return 0.42;
  if (viewportWidth < 1280) return 0.52;
  return 0.6;
}

/** Expanded-card zoom: closer than the wall, still short of filling the viewport. */
export function wallExpandedScale(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0.78;
  if (viewportWidth < 720) return 0.55;
  if (viewportWidth < 1280) return 0.68;
  return 0.78;
}

export function resolveTintColor(settings: LatticeSettings): string {
  return settings.posterTintCustom ? settings.posterTintColor : FALLBACK_TINT;
}

/** Which Folia-style tint / shade controls the function panel should keep live. */
export function controlPanelSettingLocks(settings: LatticeSettings): {
  spotlight: boolean;
  tint: boolean;
  customColor: boolean;
} {
  const spotlight = settings.lightingMode === 'spotlight';
  const tint = spotlight && settings.posterTint;
  return { spotlight, tint, customColor: tint && settings.posterTintCustom };
}

export function wallVisualsFromSettings(settings: LatticeSettings, reducedMotion: boolean): WallVisualOptions {
  const daytime = settings.lightingMode === 'daytime';
  return {
    lightsOut: daytime ? false : settings.lightsOut,
    vignette: daytime ? false : settings.vignette,
    tint: daytime ? false : settings.posterTint,
    tintColor: resolveTintColor(settings),
    tintIntensity: daytime ? 0 : settings.posterTintIntensity,
    reducedMotion,
  };
}

export function applyUiFont(font: string): void {
  const clean = sanitizeUiFont(font);
  const root = document.documentElement;
  if (clean) root.style.setProperty('--ui-font', clean);
  else root.style.removeProperty('--ui-font');
}

/** Lighting dataset, shade colour token, and UI font. Call before `wall.setVisualOptions`. */
export function applyAppearance(settings: LatticeSettings): void {
  document.body.dataset.lighting = settings.lightingMode;
  document.body.dataset.vignette = String(settings.lightingMode !== 'daytime' && settings.vignette);
  document.body.style.setProperty('--shade-color', resolveTintColor(settings));
  applyUiFont(settings.uiFont);
}

export function settingEntries(patch: Partial<LatticeSettings>): Array<[string, string | number | boolean]> {
  const entries: Array<[string, string | number | boolean]> = [];
  for (const key of Object.keys(patch) as Array<keyof LatticeSettings>) {
    const value = patch[key];
    if (value === undefined) continue;
    entries.push([SETTING_IDS[key], value]);
  }
  return entries;
}
