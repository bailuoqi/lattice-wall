// Harness-only, bounded DOM observations. No playback or host API calls.
const frame = document.getElementById('frame');
const output = document.getElementById('motion-audit');
let cleanup = () => {};
frame.addEventListener('load', () => {
  cleanup();
  const doc = frame.contentDocument;
  if (!doc || new URL(frame.src).pathname !== '/panel.html') return;
  let raf = 0, observer = null, mutations = 0, started = 0;
  let samples = [], lastSample = 0;
  const read = () => {
    const root = doc.querySelector('.poster[data-expanded="true"]');
    const rect = selector => root?.querySelector(selector)?.getBoundingClientRect();
    const controls = rect('.poster__controls'), artist = rect('.poster__artist');
    const slot = rect('.poster__lyrics'), text = rect('.lyrics__line--current .lyrics__text');
    const title = rect('.poster__title-text');
    if (!controls || !artist || !slot || !title) return null;
    return {
      controlsX: controls.x, controlsY: controls.y, artistX: artist.x,
      artistToSlot: artist.bottom - slot.y,
      textToSlot: text ? text.y - slot.y : null,
      titleX: title.x, titleY: title.y, titleHeight: title.height, slotHeight: slot.height,
    };
  };
  const report = () => {
    const span = key => {
      const values = samples.map(s => s[key]).filter(v => v !== null);
      return values.length ? +(Math.max(...values) - Math.min(...values)).toFixed(4) : 0;
    };
    const drift = Object.fromEntries(['controlsX', 'controlsY', 'artistX', 'artistToSlot', 'textToSlot', 'titleX'].map(k => [k, span(k)]));
    // Full measurements remain inspectable in the DOM, with a single bounded latest run.
    output.dataset.samples = JSON.stringify(samples);
    output.dataset.result = JSON.stringify({ frames: samples.length, drift, mutations });
    output.textContent = `motion: ${samples.length} frames · controls Δ ${drift.controlsX}/${drift.controlsY}px · lyric Δ ${drift.textToSlot}px · text edits ${mutations}`;
  };
  const tick = time => {
    const sample = read();
    if (sample && time - lastSample >= 8 && samples.length < 240) { samples.push(sample); lastSample = time; }
    if (time - started < 1200) raf = requestAnimationFrame(tick);
    else { observer?.disconnect(); observer = null; report(); }
  };
  const click = event => {
    if (!event.target.closest('.controls__button--lyrics')) return;
    if (!raf || performance.now() - started > 1200) {
      samples = [];
      mutations = 0;
      observer?.disconnect();
      observer = new MutationObserver(records => {
        mutations += records.filter(r => r.type === 'characterData' || [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 3 || n.nodeType === 1 && n.matches?.('.lyrics__word'))).length;
      });
      const slot = doc.querySelector('.poster[data-expanded="true"] .poster__lyrics');
      if (slot) observer.observe(slot, { subtree: true, childList: true, characterData: true });
    }
    cancelAnimationFrame(raf);
    started = performance.now();
    const sample = read();
    if (sample) samples.push(sample);
    raf = requestAnimationFrame(tick);
  };
  doc.addEventListener('click', click, true);
  cleanup = () => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
    doc.removeEventListener('click', click, true);
    samples = [];
  };
});
