import type { ExpandedContent } from '../types.ts';
import { measureLyricsOpenHeight } from '../lyrics/lyricsSlot.ts';
import { createLyricsTransition, LYRICS_TRANSITION_TIMING } from '../lyrics/lyricsTransition.ts';

export type AlbumContentMode = 'tracks' | 'lyrics' | 'none';
type LyricsLayout = { element: HTMLElement; viewElement: HTMLElement; hasFollowingLine(): boolean };

/** The library wall's title/slot animation, with a bounded full-height slot for album tracks. */
export function createAlbumLayout(lyrics: LyricsLayout) {
  const transition = createLyricsTransition();
  let content: ExpandedContent | null = null;
  let observer: ResizeObserver | null = null;
  let frame = 0;
  let mode: AlbumContentMode = 'none';
  let reducedMotion = false;
  let shownHeight = 0;
  let heightAnimation: Animation | null = null;

  const fit = (): void => {
    if (!content || mode === 'none') return;
    const style = getComputedStyle(content.root);
    const px = (value: string): number => Number.parseFloat(value) || 0;
    const naturalTitle = px(style.getPropertyValue('--title-natural-height'));
    const titleScale = px(style.getPropertyValue('--title-open-scale')) || 1;
    const artist = content.meta.querySelector<HTMLElement>('.poster__artist');
    const artistHeight = artist && artist.textContent
      ? artist.offsetHeight + px(getComputedStyle(artist).marginTop) : 0;
    // Use the final compact title height, never its animated height: that would feed the animation
    // back into its own target and resize the virtual track list on every frame.
    const available = Math.max(0, content.root.clientHeight - px(style.paddingTop) - px(style.paddingBottom)
      - naturalTitle * titleScale - artistHeight - content.controls.offsetHeight - px(style.rowGap) * 2);
    const height = mode === 'tracks' ? available : Math.min(available,
      measureLyricsOpenHeight(content.root, lyrics.element, lyrics.hasFollowingLine(), lyrics.viewElement));
    if (Math.abs(height - shownHeight) < 0.5) return;
    const from = px(style.getPropertyValue('--album-slot-height'));
    const open = px(style.getPropertyValue('--lyrics-open'));
    heightAnimation?.cancel();
    heightAnimation = null;
    shownHeight = height;
    transition.fit(content, height);
    content.root.style.setProperty('--album-slot-height', `${height}px`);
    // Switching between lyrics and tracks must not jump the title. The list itself keeps a
    // stable final viewport while the outer slot moves with the library wall's timing.
    if (!reducedMotion && open > 0 && Math.abs(from - height) >= 0.5) {
      const effect = content.root.animate(
        [{ '--album-slot-height': `${from}px` }, { '--album-slot-height': `${height}px` }],
        LYRICS_TRANSITION_TIMING,
      );
      heightAnimation = effect;
      effect.onfinish = () => {
        if (heightAnimation !== effect) return;
        heightAnimation = null;
        effect.cancel();
      };
    }
  };
  const scheduleFit = (): void => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(); });
  };
  const reset = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    observer = null;
    heightAnimation?.cancel();
    heightAnimation = null;
    content?.root.style.removeProperty('--album-slot-height');
    transition.reset();
    content = null;
    shownHeight = 0;
    mode = 'none';
  };

  return {
    mount(next: ExpandedContent) {
      reset();
      content = next;
      transition.fit(next, 0);
      observer = new ResizeObserver(scheduleFit);
      for (const element of [next.root, next.meta.querySelector('.poster__title-text'), next.controls, lyrics.viewElement, lyrics.element.firstElementChild]) {
        if (element) observer.observe(element);
      }
    },
    setMode(next: AlbumContentMode) {
      if (!content || next === mode) return;
      mode = next;
      fit();
      transition.toggle(content, next !== 'none', reducedMotion);
    },
    setReducedMotion(reduced: boolean) {
      reducedMotion = reduced;
      if (reduced) {
        transition.finish();
        heightAnimation?.finish();
      }
    },
    refreshLyrics() {
      // The clipped viewport can keep the same size while its rows grow. A row change must
      // request measurement explicitly; ResizeObserver alone cannot detect that overflow.
      if (content && mode === 'lyrics') scheduleFit();
    },
    reset,
  };
}
