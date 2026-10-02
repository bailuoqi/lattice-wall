import type { Camera, PixelRect, Point } from '../types.ts';
import type { PosterElement } from './poster.ts';
import { fisheyeChildMatrix } from './fisheye.ts';
import type { DepthPose } from './depthScene.ts';
import { uiParallaxOffset, type UiDepthLayer } from './uiParallax.ts';

type UnitState = { revision: number; box: PixelRect; card: PixelRect; shift: Point; lens: boolean };

/** Layout offsets remain in source coordinates even while the DOM has projected transforms. */
function sourceBox(element: HTMLElement, card: HTMLElement): PixelRect {
  let x = 0, y = 0;
  for (let node: HTMLElement | null = element; node && node !== card; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  const style = getComputedStyle(element);
  return { x, y, w: Number.parseFloat(style.width) || element.offsetWidth,
    h: Number.parseFloat(style.height) || element.offsetHeight };
}

function sameBox(a: PixelRect, b: PixelRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Keep native text, scrolling and playback input; only their presentation follows the lens. */
export function createFisheyeUiProjection(requestFrame: () => void) {
  const units = new Map<HTMLElement, UnitState>();
  const observer = new ResizeObserver(requestFrame);

  const clear = (): void => {
    observer.disconnect();
    for (const element of units.keys()) element.style.removeProperty('transform');
    units.clear();
  };

  return {
    sync(posters: Iterable<PosterElement>, camera: Camera, revision: number, surfaceReady: boolean, depth: DepthPose): boolean {
      const lens = camera.fisheye && surfaceReady;
      if (!lens && depth.amount <= 0) { clear(); return false; }
      const shownTitles = document.body.dataset.showTitles === 'true';
      const reads: { element: HTMLElement; box: PixelRect; card: PixelRect; layer: UiDepthLayer }[] = [];
      let animating = false;
      // Read all source geometry before any transform writes, including animated lyric/list slots.
      for (const poster of posters) {
        const content = poster.expanded;
        const elements: [HTMLElement, UiDepthLayer][] = content
          ? [[content.meta, 'meta'], [content.lyrics, 'lyrics'], [content.controls, 'controls']]
          : shownTitles && !poster.caption.hidden ? [[poster.caption, 'caption']] : [];
        if (content?.root.getAnimations({ subtree: true }).some(effect => effect.pending || effect.playState === 'running')) {
          animating = true;
        }
        for (const [element, layer] of elements) reads.push({ element, layer, box: sourceBox(element, poster.root), card: poster.rect });
      }
      const active = new Set(reads.map(read => read.element));
      for (const element of units.keys()) if (!active.has(element)) {
        observer.unobserve(element);
        element.style.removeProperty('transform');
        units.delete(element);
      }
      for (const { element, box, card, layer } of reads) {
        const previous = units.get(element);
        const shift = uiParallaxOffset(depth, layer, card, camera.state.scale, camera.viewport);
        if (previous?.revision === revision && previous.lens === lens && sameBox(previous.box, box)
          && sameBox(previous.card, card) && previous.shift.x === shift.x && previous.shift.y === shift.y) continue;
        if (!previous) observer.observe(element);
        units.set(element, { revision, box, card: { ...card }, shift, lens });
        if (box.w <= 0 || box.h <= 0) { element.style.removeProperty('transform'); continue; }
        const matrix = fisheyeChildMatrix(card, box, camera.state, camera.viewport, camera.fisheyeAmount, shift, lens);
        element.style.transform = `matrix3d(${matrix.join(',')})`;
      }
      return animating;
    },
    clear,
    dispose: clear,
  };
}
