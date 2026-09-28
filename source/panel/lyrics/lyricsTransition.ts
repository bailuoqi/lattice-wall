import type { ExpandedContent } from '../types.ts';

export const LYRICS_TRANSITION_TIMING = { duration: 950, easing: 'cubic-bezier(.22, 1, .36, 1)' };

/** One progress value owns the title's occupied height, its uniform size and the lyric slot.
 * Text keeps its line breaks while toggling; no per-frame font layout or endpoint FLIP. */
export function createLyricsTransition() {
  let content: ExpandedContent | null = null;
  let animation: Animation | null = null;
  let heightAnimation: Animation | null = null;
  let observer: ResizeObserver | null = null;

  function measureTitle(): void {
    const title = content?.meta.querySelector<HTMLElement>('.poster__title');
    if (!title || !content) return;
    let text = title.querySelector<HTMLElement>('.poster__title-text');
    if (!text) {
      text = document.createElement('span');
      text.className = 'poster__title-text';
      text.textContent = title.textContent;
      title.replaceChildren(text);
    }
    const large = Number.parseFloat(getComputedStyle(title).fontSize);
    // Resolve the existing responsive small size in the same query container.
    text.style.fontSize = 'clamp(40px, 7.6cqw, 69px)';
    const small = Number.parseFloat(getComputedStyle(text).fontSize);
    text.style.removeProperty('font-size');
    content.root.style.setProperty('--title-natural-height', getComputedStyle(text).height);
    content.root.style.setProperty('--title-open-scale', String(small / large));
  }

  function bind(next: ExpandedContent): void {
    if (content === next) return;
    reset();
    content = next;
    measureTitle();
    const text = next.meta.querySelector('.poster__title-text');
    if (text) {
      observer = new ResizeObserver(measureTitle);
      observer.observe(text);
    }
  }

  function fit(next: ExpandedContent, height: number, animate = false): void {
    bind(next);
    const root = next.root;
    const target = Number.parseFloat(root.style.getPropertyValue('--lyrics-open-height'));
    if (Math.abs(target - height) < 0.5) return;
    const style = getComputedStyle(root);
    const from = Number.parseFloat(style.getPropertyValue('--lyrics-open-height')) || 0;
    const open = Number.parseFloat(style.getPropertyValue('--lyrics-open')) || 0;
    // Retarget from the visible height, including when a seek interrupts the previous line.
    heightAnimation?.cancel();
    heightAnimation = null;
    root.style.setProperty('--lyrics-open-height', `${height}px`);
    if (!animate || open <= 0 || Math.abs(from - height) < 0.5) return;
    const effect = root.animate(
      [{ '--lyrics-open-height': `${from}px` }, { '--lyrics-open-height': `${height}px` }],
      LYRICS_TRANSITION_TIMING,
    );
    heightAnimation = effect;
    effect.onfinish = () => {
      if (heightAnimation !== effect) return;
      heightAnimation = null;
      effect.cancel();
    };
  }

  function finish(): void {
    animation?.finish();
    heightAnimation?.finish();
  }

  function toggle(next: ExpandedContent, open: boolean, reduced: boolean, onFinish?: () => void): void {
    bind(next);
    const root = next.root;
    const from = Number.parseFloat(getComputedStyle(root).getPropertyValue('--lyrics-open')) || 0;
    animation?.cancel();
    animation = null;
    const to = open ? 1 : 0;
    // The base style is the exact endpoint. Removing the effect never changes geometry.
    root.style.setProperty('--lyrics-open', String(to));
    if (reduced || from === to) {
      onFinish?.();
      return;
    }
    const effect = root.animate(
      [{ '--lyrics-open': String(from) }, { '--lyrics-open': String(to) }],
      LYRICS_TRANSITION_TIMING,
    );
    animation = effect;
    effect.onfinish = () => {
      if (animation !== effect) return;
      animation = null;
      effect.cancel();
      onFinish?.();
    };
  }

  function reset(): void {
    animation?.cancel();
    animation = null;
    heightAnimation?.cancel();
    heightAnimation = null;
    observer?.disconnect();
    observer = null;
    if (content) {
      for (const name of ['--lyrics-open', '--lyrics-open-height', '--title-natural-height', '--title-open-scale']) {
        content.root.style.removeProperty(name);
      }
    }
    content = null;
  }

  return { fit, toggle, reset, finish, get running() { return animation !== null; } };
}
