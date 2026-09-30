type SwapJob = { start: (done: () => void) => () => void; cancel: (() => void) | null };

/** Shared queue for at most two temporary decoded size replacements. */
export function createCoverSwapQueue() {
  const waiting = new Set<SwapJob>();
  const active = new Set<SwapJob>();
  let disposed = false;
  let paused = false;
  function pump(): void {
    while (!disposed && !paused && active.size < 2 && waiting.size) {
      const job = waiting.values().next().value!;
      waiting.delete(job); active.add(job);
      job.cancel = job.start(() => {
        active.delete(job); job.cancel = null; pump();
      });
      if (!active.has(job)) { job.cancel?.(); job.cancel = null; }
    }
  }
  function clear(): void {
    waiting.clear();
    for (const job of active) job.cancel?.();
    active.clear();
  }
  return {
    enqueue(start: SwapJob['start']): () => void {
      if (disposed) return () => {};
      const job: SwapJob = { start, cancel: null };
      waiting.add(job); pump();
      return () => {
        waiting.delete(job); active.delete(job);
        const cancel = job.cancel; job.cancel = null;
        cancel?.(); pump();
      };
    },
    clear,
    /** Finish at most the two in-flight decodes; defer the remaining size swaps during motion. */
    setPaused(next: boolean): void {
      if (paused === next) return;
      paused = next;
      if (!paused) pump();
    },
    dispose(): void { disposed = true; clear(); },
  };
}

export type CoverSwapQueue = ReturnType<typeof createCoverSwapQueue>;

function createImage(): HTMLImageElement {
  const image = document.createElement('img');
  image.className = 'poster__cover';
  image.loading = 'eager'; image.decoding = 'async';
  image.alt = ''; image.draggable = false; image.hidden = true;
  return image;
}

/** Keep the current cover visible until its replacement is decoded and ready to display. */
export function createPosterCover(queue: CoverSwapQueue) {
  let image = createImage();
  let base: string | null = null;
  let source: string | null = null;
  let failed: string | null = null;
  let pending: { source: string; cancel: (() => void) | null } | null = null;

  function cancelPending(): void {
    const previous = pending; pending = null;
    previous?.cancel?.();
  }

  function clear(): void {
    cancelPending(); base = null; source = null; failed = null;
    image.onerror = null; image.hidden = true; image.removeAttribute('src');
  }

  function showInitial(src: string): void {
    source = src;
    image.onerror = () => {
      failed ??= source;
      if (base !== null && source !== base) showInitial(base);
      else image.hidden = true;
    };
    image.src = src; image.hidden = false;
  }

  function requestCover(src: string | null, nextBase: string | null): void {
    if (src === null || nextBase === null) { clear(); return; }
    if (base !== nextBase) {
      clear(); base = nextBase;
    }
    cancelPending();
    if (source === null) { showInitial(src); return; }
    if (source === src || failed === src) return;
    const request = { source: src, cancel: null as (() => void) | null };
    pending = request;
    request.cancel = queue.enqueue(done => {
      const next = createImage();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let finished = false;
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null; next.onload = null; next.onerror = null;
      };
      const finish = (ready: boolean) => {
        if (finished) return;
        finished = true; cleanup();
        if (pending === request) {
          pending = null;
          if (ready) {
            const previous = image;
            next.hidden = false; image = next; source = src;
            if (previous !== next) {
              previous.replaceWith(next);
              previous.onerror = null; previous.removeAttribute('src');
            }
          } else if (src !== base || failed === null) failed = src;
        }
        if (!ready || image !== next) next.removeAttribute('src');
        done();
      };
      next.onerror = () => finish(false);
      timer = setTimeout(() => finish(false), 10000);
      next.src = src;
      if (typeof next.decode === 'function') void next.decode().then(() => finish(true), () => finish(false));
      else next.onload = () => finish(true);
      return () => {
        finished = true; cleanup(); next.removeAttribute('src');
      };
    });
  }

  return {
    get image() { return image; },
    get source() { return source; },
    matches(src: string | null): boolean {
      if (src !== null && src === failed) return true;
      return src === (pending?.source ?? source);
    },
    request: requestCover,
    clear,
  };
}

export type PosterCover = ReturnType<typeof createPosterCover>;
