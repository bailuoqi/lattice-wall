/** Permit 240 Hz vsync while bounding hosts whose rAF runs without vsync. */
export const INTERACTIVE_FRAME_MS = 4;

/** One demand-driven frame owner per wall. Hidden and disposed walls never re-arm themselves. */
export function createWallFrameLoop(render: (time: number) => boolean, intervalMs: number | (() => number), visible: boolean) {
  let frameId = 0;
  let disposed = false;
  let lastFrame = -Infinity;
  let interactivePending = false;
  const request = (): void => {
    if (!disposed && visible && !frameId) frameId = requestAnimationFrame(frame);
  };
  function frame(time: number): void {
    frameId = 0;
    if (disposed || !visible) return;
    const interval = interactivePending ? INTERACTIVE_FRAME_MS
      : typeof intervalMs === 'function' ? intervalMs() : intervalMs;
    if (time - lastFrame < interval) { request(); return; }
    interactivePending = false;
    lastFrame = time;
    if (render(time)) request();
  }
  const cancel = (): void => {
    cancelAnimationFrame(frameId);
    frameId = 0;
    interactivePending = false;
  };
  return {
    request,
    /** Direct input must not wait for a desktop wall's idle playback cadence. */
    requestInteractive() {
      if (disposed || !visible) return;
      interactivePending = true;
      request();
    },
    setVisible(next: boolean) {
      visible = next;
      if (!visible) cancel();
      else { lastFrame = -Infinity; request(); }
    },
    dispose() { disposed = true; cancel(); },
  };
}
