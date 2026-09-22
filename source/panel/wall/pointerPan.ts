import type { PointerPan, PointerPanHandlers } from '../types.ts';

const DRAG_THRESHOLD_PX = 7;
/** Release velocity is measured over the samples from roughly this long before the release. */
const VELOCITY_WINDOW_MS = 80;
/** Two samples closer than this are release jitter, not a flick. */
const MIN_VELOCITY_SPAN_MS = 8;
const SAMPLE_CAPACITY = 8;
const CLICK_SUPPRESSION_MS = 300;
const LINE_DELTA_PX = 16;
/** Controls inside expanded cards keep their native pointer behaviour and their clicks. */
const INTERACTIVE_SELECTOR = 'button, input, a, select, textarea, [role="slider"]';

function at(values: Float64Array, index: number): number {
  return values[index] ?? 0;
}

/**
 * Drag / fling / tap / wheel input for the wall viewport.
 *
 * - The pointer is captured only once the 7 px drag threshold is crossed, so a plain tap still lets
 *   the native `click` reach the element under the pointer (the wall's delegated click handler).
 * - After a drag, the trailing `click` is swallowed in the capture phase on `field`.
 * - `onTap` reports the `pointerdown` target (the element the user pressed on).
 * - `onWheel(dx, dy)` receives normalised scroll deltas in screen px, positive = scroll down / right,
 *   i.e. the direction the content is expected to move *against*: pan the camera by `(-dx, -dy)`
 *   for the natural scrolling feel.
 */
export function attachPointerPan(field: HTMLElement, handlers: PointerPanHandlers): PointerPan {
  let activePointerId: number | null = null;
  let downTarget: EventTarget | null = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;

  const sampleTimes = new Float64Array(SAMPLE_CAPACITY);
  const sampleXs = new Float64Array(SAMPLE_CAPACITY);
  const sampleYs = new Float64Array(SAMPLE_CAPACITY);
  let sampleHead = 0;
  let sampleCount = 0;

  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | null = null;

  function pushSample(time: number, x: number, y: number): void {
    sampleTimes[sampleHead] = time;
    sampleXs[sampleHead] = x;
    sampleYs[sampleHead] = y;
    sampleHead = (sampleHead + 1) % SAMPLE_CAPACITY;
    if (sampleCount < SAMPLE_CAPACITY) sampleCount += 1;
  }

  /** Screen-space velocity (px/s) between the newest sample and the oldest one inside the window. */
  function releaseVelocity(): [number, number] {
    const newest = (sampleHead + SAMPLE_CAPACITY - 1) % SAMPLE_CAPACITY;
    const endTime = at(sampleTimes, newest);
    let oldest = newest;
    for (let back = 1; back < sampleCount; back += 1) {
      const index = (newest + SAMPLE_CAPACITY - back) % SAMPLE_CAPACITY;
      if (endTime - at(sampleTimes, index) > VELOCITY_WINDOW_MS) break;
      oldest = index;
    }
    const span = endTime - at(sampleTimes, oldest);
    if (span < MIN_VELOCITY_SPAN_MS) return [0, 0];
    const perSecond = 1000 / span;
    return [
      (at(sampleXs, newest) - at(sampleXs, oldest)) * perSecond,
      (at(sampleYs, newest) - at(sampleYs, oldest)) * perSecond,
    ];
  }

  function disarmClickSuppression(): void {
    suppressClick = false;
    if (suppressTimer !== null) {
      clearTimeout(suppressTimer);
      suppressTimer = null;
    }
  }

  function armClickSuppression(): void {
    disarmClickSuppression();
    suppressClick = true;
    suppressTimer = setTimeout(disarmClickSuppression, CLICK_SUPPRESSION_MS);
  }

  function endGesture(): void {
    activePointerId = null;
    downTarget = null;
    dragging = false;
  }

  function onPointerDown(event: PointerEvent): void {
    if (activePointerId !== null || event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null) return;
    activePointerId = event.pointerId;
    downTarget = target;
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    dragging = false;
    sampleHead = 0;
    sampleCount = 0;
    pushSample(event.timeStamp, event.clientX, event.clientY);
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    const x = event.clientX;
    const y = event.clientY;
    pushSample(event.timeStamp, x, y);
    if (!dragging) {
      if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD_PX) return;
      // The wall follows from the crossing point, so the drag starts without a 7 px jump.
      dragging = true;
      lastX = x;
      lastY = y;
      try {
        field.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can vanish between events (or be synthetic); the gesture still works uncaptured.
      }
      handlers.onDragStart();
      return;
    }
    const dx = x - lastX;
    const dy = y - lastY;
    lastX = x;
    lastY = y;
    if (dx !== 0 || dy !== 0) handlers.onPan(dx, dy);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    pushSample(event.timeStamp, event.clientX, event.clientY);
    const target = downTarget;
    const wasDragging = dragging;
    endGesture();
    if (wasDragging) {
      const [vx, vy] = releaseVelocity();
      armClickSuppression();
      handlers.onFling(vx, vy);
      handlers.onDragEnd();
    } else {
      handlers.onTap(target, event.clientX, event.clientY);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    const wasDragging = dragging;
    endGesture();
    if (wasDragging) handlers.onDragEnd();
  }

  function onClickCapture(event: MouseEvent): void {
    if (!suppressClick) return;
    disarmClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onWheel(event: WheelEvent): void {
    // Scrollable text inside a card (plain lyrics) keeps native wheel scrolling.
    if (event.target instanceof Element) {
      const scrollable = event.target.closest<HTMLElement>('[data-scrollable]');
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return;
    }
    event.preventDefault();
    let dx = event.deltaX;
    let dy = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      dx *= LINE_DELTA_PX;
      dy *= LINE_DELTA_PX;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      dx *= field.clientWidth;
      dy *= field.clientHeight;
    }
    // Some platforms already deliver Shift+wheel as deltaX; only convert when they did not.
    if (event.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }
    if (dx !== 0 || dy !== 0) handlers.onWheel(dx, dy);
  }

  /** A native image drag would cancel the pointer gesture halfway through a pan. */
  function onNativeDragStart(event: DragEvent): void {
    event.preventDefault();
  }

  field.addEventListener('pointerdown', onPointerDown);
  field.addEventListener('pointermove', onPointerMove);
  field.addEventListener('pointerup', onPointerUp);
  field.addEventListener('pointercancel', onPointerCancel);
  field.addEventListener('lostpointercapture', onPointerCancel);
  field.addEventListener('click', onClickCapture, true);
  field.addEventListener('wheel', onWheel, { passive: false });
  field.addEventListener('dragstart', onNativeDragStart);

  return {
    dispose() {
      field.removeEventListener('pointerdown', onPointerDown);
      field.removeEventListener('pointermove', onPointerMove);
      field.removeEventListener('pointerup', onPointerUp);
      field.removeEventListener('pointercancel', onPointerCancel);
      field.removeEventListener('lostpointercapture', onPointerCancel);
      field.removeEventListener('click', onClickCapture, true);
      field.removeEventListener('wheel', onWheel);
      field.removeEventListener('dragstart', onNativeDragStart);
      disarmClickSuppression();
      endGesture();
    },
  };
}
