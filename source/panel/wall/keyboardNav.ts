import type { Direction } from '../types.ts';

export type KeyboardActions = {
  move(direction: Direction): void;
  activate(): void;
  secondary(): void;
  escape(): void;
  focusCurrent(): void;
  toggle(setting: 'lights-out' | 'vignette' | 'tint'): void;
  /** Seek relative to the current position; returns false when seeking is not applicable right now. */
  seekBy(deltaSeconds: number): boolean;
};

const SEEK_STEP_SECONDS = 5;
const ARROW_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
const TEXT_ENTRY_SELECTOR = 'input, textarea, select';
/** Elements the browser activates itself on Enter / Space; handling them here would fire twice. */
const NATIVE_ACTIVATION_SELECTOR = 'button, a[href]';

function isTextEntry(origin: Element): boolean {
  return origin.closest(TEXT_ENTRY_SELECTOR) !== null || (origin instanceof HTMLElement && origin.isContentEditable);
}

/**
 * SPEC §2.4 key map on `keydown` (bubbling) for `target`.
 *
 * - Events with Ctrl / Meta / Alt pass through untouched so host shortcuts keep working.
 * - Events already handled by a descendant (`defaultPrevented`) are ignored; card-level handlers
 *   should call `preventDefault()` when they consume a key.
 * - Text entry targets are ignored, except `input[type=range]` (the seek slider) whose arrow keys map
 *   to `seekBy(±5)` while Escape and the letter toggles keep working.
 * - `preventDefault()` is called only for keys that were handled. Arrows may auto-repeat; the other
 *   keys ignore repeats.
 */
export function attachKeyboardNav(target: HTMLElement, actions: KeyboardActions): { dispose(): void } {
  function onKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const origin = event.target instanceof Element ? event.target : null;
    const onSlider = origin instanceof HTMLInputElement && origin.type === 'range';
    if (origin !== null && !onSlider && isTextEntry(origin)) return;

    const direction = ARROW_DIRECTIONS[event.key];
    if (direction !== undefined) {
      if (onSlider) {
        const delta = direction === 'left' || direction === 'down' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
        if (actions.seekBy(delta)) event.preventDefault();
        return;
      }
      if (direction === 'left' || direction === 'right') {
        if (actions.seekBy(direction === 'left' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS)) {
          event.preventDefault();
          return;
        }
      }
      actions.move(direction);
      event.preventDefault();
      return;
    }

    if (event.repeat) return;
    const key = event.code === 'Space' ? ' ' : event.key;
    // On the slider only Escape and the letter toggles apply; Enter / Space stay with the control.
    if (onSlider && key !== 'Escape' && key.length !== 1) return;
    switch (key) {
      case 'Enter':
        if (onSlider || (origin !== null && origin.closest(NATIVE_ACTIVATION_SELECTOR) !== null)) return;
        actions.activate();
        break;
      case ' ':
        if (onSlider || (origin !== null && origin.closest(NATIVE_ACTIVATION_SELECTOR) !== null)) return;
        actions.secondary();
        break;
      case 'Escape':
        actions.escape();
        break;
      case 'c':
      case 'C':
        actions.focusCurrent();
        break;
      case 'l':
      case 'L':
        actions.toggle('lights-out');
        break;
      case 'v':
      case 'V':
        actions.toggle('vignette');
        break;
      case 't':
      case 'T':
        actions.toggle('tint');
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  target.addEventListener('keydown', onKeyDown);
  return {
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
