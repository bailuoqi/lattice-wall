/**
 * Playback controls (SPEC §2.3): the control cluster re-parented into whichever card is expanded.
 * Driven by `update(clock)` once per frame; every write is guarded so an unchanged clock costs
 * nothing. The seek row only applies to the current track, so `mode: 'other'` hides it (CSS) and
 * keeps the slider out of the keyboard seek flow.
 */

import type { ClockSnapshot, ControlHandlers, WallControls } from '../types.ts';
import { formatTime } from './poster.ts';

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">';
const ICONS = {
  previous: `${SVG_OPEN}<path d="M6 5h2.4v14H6zM18 5.5v13L9.4 12z"/></svg>`,
  next: `${SVG_OPEN}<path d="M15.6 5H18v14h-2.4zM6 5.5v13l8.6-6.5z"/></svg>`,
  play: `${SVG_OPEN}<path d="M8 5.5v13l10-6.5z"/></svg>`,
  pause: `${SVG_OPEN}<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>`,
  lyrics: `${SVG_OPEN}<path d="M6 5.5h12v2.2H6zm0 5.4h8.5v2.2H6zm0 5.4h12v2.2H6z"/></svg>`,
  shuffle: `${SVG_OPEN}<path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zm3.91-5.17 2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`,
  repeatOne: `${SVG_OPEN}<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>`,
} as const;

const TOGGLE_MARKUP =
  `<span class="controls__glyph" data-glyph="play">${ICONS.play}</span>` +
  `<span class="controls__glyph" data-glyph="pause">${ICONS.pause}</span>`;

/**
 * Native range-input keys that would jump the position without going through the ±5 s seek flow.
 * Arrow keys are deliberately left alone: keyboardNav.ts skips already-prevented events and handles
 * the slider's arrows itself (seek, then `preventDefault`).
 */
const SLIDER_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown']);

type Action = 'previous' | 'next' | 'primary' | 'lyrics' | 'shuffle' | 'repeatOne';

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function createButton(className: string, action: Action, label: string, markup: string): HTMLButtonElement {
  const button = createElement('button', className);
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.innerHTML = markup;
  return button;
}

export function createWallControls(handlers: ControlHandlers): WallControls {
  const abort = new AbortController();
  const signal = abort.signal;

  let mode: 'current' | 'other' = 'current';
  let playing = false;
  let hidden = false;
  let dragging = false;

  let shownDuration = -1;
  let shownValue = -1;
  let shownProgress = '';
  let shownWholeSecond = -1;
  let shownState = '';

  const cluster = createElement('div', 'controls');
  cluster.dataset.mode = mode;
  cluster.dataset.state = 'paused';

  const row = createElement('div', 'controls__row');
  const previous = createButton('controls__button controls__button--skip', 'previous', '上一曲', ICONS.previous);
  const primary = createButton('controls__button controls__button--primary', 'primary', '播放', TOGGLE_MARKUP);
  const next = createButton('controls__button controls__button--skip', 'next', '下一曲', ICONS.next);
  const shuffle = createButton('controls__button controls__button--shuffle', 'shuffle', '随机播放', ICONS.shuffle);
  shuffle.setAttribute('aria-pressed', 'false');
  shuffle.dataset.on = 'false';
  const repeatOne = createButton('controls__button controls__button--repeat', 'repeatOne', '单曲循环', ICONS.repeatOne);
  repeatOne.setAttribute('aria-pressed', 'false');
  repeatOne.dataset.on = 'false';
  const lyrics = createButton('controls__button controls__button--lyrics', 'lyrics', '隐藏歌词', ICONS.lyrics);
  lyrics.setAttribute('aria-pressed', 'true');
  lyrics.dataset.on = 'true';
  row.append(previous, primary, next, shuffle, repeatOne, lyrics);

  const seek = createElement('div', 'controls__seek');
  const slider = createElement('input', 'controls__slider');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '0';
  slider.step = '0.1';
  slider.value = '0';
  slider.setAttribute('aria-label', '播放进度');
  const time = createElement('span', 'controls__time');
  time.textContent = '0:00 / 0:00';
  seek.append(slider, time);
  cluster.append(row, seek);

  // Behaviour --------------------------------------------------------------------------------------

  function updateLabels(): void {
    primary.setAttribute('aria-label', mode === 'other' || !playing ? '播放' : '暂停');
    const collapsed = mode === 'other';
    for (const button of [previous, next, shuffle, repeatOne, lyrics]) {
      button.tabIndex = collapsed ? -1 : 0;
      button.setAttribute('aria-hidden', String(collapsed));
    }
  }

  function runAction(action: string): void {
    switch (action) {
      case 'previous':
        handlers.previous();
        break;
      case 'next':
        handlers.next();
        break;
      case 'primary':
        if (mode === 'other') handlers.playThis();
        else if (playing) handlers.pause();
        else handlers.play();
        break;
      case 'lyrics':
        if (mode !== 'other') handlers.toggleLyrics();
        break;
      case 'shuffle':
        if (mode !== 'other') handlers.toggleShuffle();
        break;
      case 'repeatOne':
        if (mode !== 'other') handlers.toggleRepeatOne();
        break;
      default:
        break;
    }
  }

  cluster.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-action]');
      if (button?.dataset.action) runAction(button.dataset.action);
    },
    { signal },
  );
  // Pointer presses on controls must never start a wall drag.
  cluster.addEventListener('pointerdown', (event) => event.stopPropagation(), { signal });

  /**
   * 0.1 % steps: on a 1200 px slider that is about one device pixel, and it turns a style write plus
   * repaint of the expanded card on nearly every frame into one every couple of hundred milliseconds.
   */
  const progressRatio = (position: number, duration: number): string =>
    (duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0).toFixed(3);

  function setSliderProgress(ratio: string): void {
    if (ratio === shownProgress) return;
    shownProgress = ratio;
    slider.style.setProperty('--progress', ratio);
  }

  slider.addEventListener(
    'input',
    () => {
      const value = Number(slider.value);
      setSliderProgress(progressRatio(value, Number(slider.max)));
      handlers.seek(value);
    },
    { signal },
  );
  slider.addEventListener(
    'pointerdown',
    () => {
      dragging = true;
    },
    { signal },
  );
  const endDrag = (): void => {
    dragging = false;
  };
  slider.addEventListener('pointerup', endDrag, { signal });
  slider.addEventListener('pointercancel', endDrag, { signal });
  slider.addEventListener('lostpointercapture', endDrag, { signal });
  slider.addEventListener('change', endDrag, { signal });
  slider.addEventListener(
    'keydown',
    (event) => {
      if (SLIDER_KEYS.has(event.key)) event.preventDefault();
    },
    { signal },
  );

  function setHidden(next: boolean): void {
    hidden = next;
    if (next) cluster.dataset.hidden = 'true';
    else delete cluster.dataset.hidden;
    cluster.inert = next;
  }

  return {
    mountExpanded(container, nextMode) {
      mode = nextMode;
      cluster.dataset.mode = nextMode;
      updateLabels();
      if (cluster.parentElement !== container) container.appendChild(cluster);
    },

    unmountExpanded() {
      const active = document.activeElement;
      // Keep DOM focus inside the card instead of letting it fall to <body> with the cluster.
      if (active && cluster.contains(active)) cluster.closest<HTMLElement>('.poster')?.focus({ preventScroll: true });
      cluster.remove();
      dragging = false;
    },

    setControlsHidden(next) {
      if (next !== hidden) setHidden(next);
    },

    get controlsHidden() {
      return hidden;
    },

    update(clock) {
      const duration = Number.isFinite(clock.durationSeconds) && clock.durationSeconds > 0 ? clock.durationSeconds : 0;
      let position = Number.isFinite(clock.positionSeconds) ? Math.max(0, clock.positionSeconds) : 0;
      if (duration > 0 && position > duration) position = duration;

      const durationChanged = duration !== shownDuration;
      if (durationChanged) {
        shownDuration = duration;
        slider.max = String(duration);
      }
      if (!dragging) {
        const value = Math.round(position * 10) / 10;
        if (value !== shownValue) {
          shownValue = value;
          slider.value = String(value);
        }
      }
      setSliderProgress(progressRatio(position, duration));

      const wholeSecond = Math.floor(position);
      if (durationChanged || wholeSecond !== shownWholeSecond) {
        shownWholeSecond = wholeSecond;
        time.textContent = `${formatTime(wholeSecond)} / ${formatTime(duration)}`;
      }

      const state = clock.state === 'playing' ? 'playing' : 'paused';
      if (state !== shownState) {
        shownState = state;
        playing = state === 'playing';
        cluster.dataset.state = state;
        updateLabels();
      }
    },

    focusSeek() {
      if (!slider.isConnected || hidden || mode === 'other') return false;
      slider.focus({ preventScroll: true });
      return document.activeElement === slider;
    },

    get seekFocused() {
      return mode === 'current' && document.activeElement === slider;
    },

    setLyricsVisible(visible) {
      lyrics.dataset.on = String(visible);
      lyrics.setAttribute('aria-pressed', String(visible));
      lyrics.setAttribute('aria-label', visible ? '隐藏歌词' : '显示歌词');
    },

    setShuffleEnabled(enabled) {
      shuffle.dataset.on = String(enabled);
      shuffle.setAttribute('aria-pressed', String(enabled));
      shuffle.setAttribute('aria-label', enabled ? '关闭随机播放' : '随机播放');
    },

    setRepeatOne(enabled) {
      repeatOne.dataset.on = String(enabled);
      repeatOne.setAttribute('aria-pressed', String(enabled));
      repeatOne.setAttribute('aria-label', enabled ? '关闭单曲循环' : '单曲循环');
    },

    dispose() {
      abort.abort();
      cluster.remove();
    },
  };
}
