import { formatTime } from '../wall/poster.ts';

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">';
const ICONS = {
  album: `${SVG_OPEN}<path d="M3 6h18v2.2H3zm0 5.4h9V14H3zM3 16.8h7v2.2H3z"/><path d="m16 11 7 5-7 5z"/></svg>`,
  previous: `${SVG_OPEN}<path d="M6 5h2.4v14H6zM18 5.5v13L9.4 12z"/></svg>`,
  play: `${SVG_OPEN}<path d="M8 5.5v13l10-6.5z"/></svg>`,
  pause: `${SVG_OPEN}<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>`,
  next: `${SVG_OPEN}<path d="M15.6 5H18v14h-2.4zM6 5.5v13l8.6-6.5z"/></svg>`,
  shuffle: `${SVG_OPEN}<path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zm3.91-5.17 2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`,
  repeatOne: `${SVG_OPEN}<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>`,
} as const;

const TOGGLE_MARKUP =
  `<span class="controls__glyph" data-glyph="play">${ICONS.play}</span>` +
  `<span class="controls__glyph" data-glyph="pause">${ICONS.pause}</span>`;

type Action = 'previous' | 'next' | 'primary' | 'album' | 'shuffle' | 'repeatOne';

export type AlbumActionHandlers = {
  playAlbum(): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  previous(): void;
  next(): void;
  seek(positionSeconds: number): void;
  toggleShuffle(): void;
  toggleRepeatOne(): void;
};

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.code === 'Space' || event.key === ' ';
}

function createButton(className: string, action: Action, label: string, markup: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.innerHTML = markup;
  return button;
}

/** Footer cluster: same chrome as the library wall, plus play-album instead of lyrics. */
export function createAlbumActions(handlers: AlbumActionHandlers) {
  const cluster = document.createElement('div');
  cluster.className = 'controls album-actions';
  cluster.dataset.mode = 'other';
  cluster.dataset.state = 'paused';

  const row = document.createElement('div');
  row.className = 'controls__row';
  const previous = createButton('controls__button controls__button--skip', 'previous', '上一曲', ICONS.previous);
  const primary = createButton('controls__button controls__button--primary', 'primary', '播放', TOGGLE_MARKUP);
  const next = createButton('controls__button controls__button--skip', 'next', '下一曲', ICONS.next);
  const shuffle = createButton('controls__button controls__button--shuffle', 'shuffle', '随机播放', ICONS.shuffle);
  shuffle.setAttribute('aria-pressed', 'false');
  shuffle.dataset.on = 'false';
  const repeatOne = createButton('controls__button controls__button--repeat', 'repeatOne', '单曲循环', ICONS.repeatOne);
  repeatOne.setAttribute('aria-pressed', 'false');
  repeatOne.dataset.on = 'false';
  const album = createButton('controls__button controls__button--album', 'album', '播放整张专辑', ICONS.album);
  row.append(previous, primary, next, shuffle, repeatOne, album);

  const seek = document.createElement('div');
  seek.className = 'controls__seek';
  const slider = document.createElement('input');
  slider.className = 'controls__slider';
  slider.type = 'range';
  slider.min = '0';
  slider.max = '0';
  slider.step = '0.1';
  slider.value = '0';
  slider.setAttribute('aria-label', '播放进度');
  const time = document.createElement('span');
  time.className = 'controls__time';
  time.textContent = '0:00 / 0:00';
  seek.append(slider, time);
  cluster.append(row, seek);

  let mode: 'current' | 'other' = 'other';
  let playing = false;
  let dragging = false;
  let shownDuration = -1;
  let shownValue = -1;
  let shownProgress = '';
  let shownWholeSecond = -1;
  let shownState = '';

  const updateLabels = (): void => {
    primary.setAttribute('aria-label', mode === 'other' || !playing ? '播放' : '暂停');
    const collapsed = mode === 'other';
    for (const button of [previous, next, shuffle, repeatOne]) {
      button.tabIndex = collapsed ? -1 : 0;
      button.setAttribute('aria-hidden', String(collapsed));
    }
  };
  updateLabels();

  const progressRatio = (position: number, duration: number): string =>
    (duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0).toFixed(3);

  const setSliderProgress = (ratio: string): void => {
    if (ratio === shownProgress) return;
    shownProgress = ratio;
    slider.style.setProperty('--progress', ratio);
  };

  const runAction = (action: string): void => {
    switch (action) {
      case 'album':
        handlers.playAlbum();
        break;
      case 'previous':
        if (mode !== 'other') handlers.previous();
        break;
      case 'next':
        if (mode !== 'other') handlers.next();
        break;
      case 'primary':
        if (mode === 'other') handlers.playAlbum();
        else if (playing) handlers.pause();
        else handlers.play();
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
  };

  cluster.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('button[data-action]');
    if (button?.dataset.action) runAction(button.dataset.action);
  });
  cluster.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !isSpaceKey(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
    // Space on a focused <button> synthesizes a click. After play-album the focus stays on that
    // button, so the native click would call playAlbum again and restart the record.
    if (action !== 'album' || mode !== 'current') return;
    event.preventDefault();
    handlers.togglePlay();
  });
  cluster.addEventListener('pointerdown', (event) => event.stopPropagation());

  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    setSliderProgress(progressRatio(value, Number(slider.max)));
    handlers.seek(value);
  });
  slider.addEventListener('pointerdown', () => {
    dragging = true;
  });
  const endDrag = (): void => {
    dragging = false;
  };
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('lostpointercapture', endDrag);
  slider.addEventListener('change', endDrag);

  return {
    element: cluster,
    playAlbum() {
      handlers.playAlbum();
    },
    setMode(next: 'current' | 'other') {
      if (mode === next) return;
      mode = next;
      cluster.dataset.mode = next;
      updateLabels();
    },
    update(clock: { positionSeconds: number; durationSeconds: number; state: string }) {
      const duration = Number.isFinite(clock.durationSeconds) && clock.durationSeconds > 0 ? clock.durationSeconds : 0;
      let position = Number.isFinite(clock.positionSeconds) ? Math.max(0, clock.positionSeconds) : 0;
      if (duration > 0 && position > duration) position = duration;
      if (duration !== shownDuration) {
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
      if (duration !== shownDuration || wholeSecond !== shownWholeSecond) {
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
    setShuffleEnabled(enabled: boolean) {
      shuffle.dataset.on = String(enabled);
      shuffle.setAttribute('aria-pressed', String(enabled));
      shuffle.setAttribute('aria-label', enabled ? '关闭随机播放' : '随机播放');
    },
    setRepeatOne(enabled: boolean) {
      repeatOne.dataset.on = String(enabled);
      repeatOne.setAttribute('aria-pressed', String(enabled));
      repeatOne.setAttribute('aria-label', enabled ? '关闭单曲循环' : '单曲循环');
    },
    focusSeek() {
      if (!slider.isConnected || mode === 'other') return false;
      slider.focus({ preventScroll: true });
      return document.activeElement === slider;
    },
    get seekFocused() {
      return mode === 'current' && document.activeElement === slider;
    },
  };
}
