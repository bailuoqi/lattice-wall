/**
 * Lyrics layer for the expanded current-track card (SPEC §9): current / next rows with a
 * word-by-word highlight driven by `update(positionMs)`. The caller owns the rAF loop; this module never
 * schedules timers or frames. Styles live in `source/styles/40-lyrics.css`.
 */
import type { LyricsLine, LyricsTimeline, LyricsView, LyricsViewOptions } from '../types.ts';
import { findLineIndex } from './lyricsModel.ts';

const INTERLUDE_TEXT = '· · ·';
const INSTRUMENTAL_TEXT = '♪ 纯音乐';
const ENTRANCE_MS = 320;

type RowRole = 'current' | 'next';
type Row = { root: HTMLElement; text: HTMLElement; translation: HTMLElement };
type WordGlow = 'upcoming' | 'active' | 'sung';

export function createLyricsView(): LyricsView {
  const root = document.createElement('div');
  root.className = 'lyrics';
  root.hidden = true;

  const live = document.createElement('span');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');

  const rows: Record<RowRole, Row> = {
    current: createRow('current'),
    next: createRow('next'),
  };

  let options: LyricsViewOptions = { showTranslation: true, reducedMotion: false };
  let lines: LyricsLine[] | null = null;
  let offsetMs = 0;
  let lineIndex = -1;
  let lastTimeMs = Number.NaN;
  let wordSpans: HTMLSpanElement[] = [];
  let lastGlow: WordGlow[] = [];
  let entrance: Animation | null = null;
  let disposed = false;
  let shownTimeline: LyricsTimeline | null = null;

  applyOptionAttributes();

  function applyOptionAttributes(): void {
    root.dataset.translation = String(options.showTranslation);
    root.dataset.reducedMotion = String(options.reducedMotion);
  }

  function resetSyncedState(): void {
    lines = null;
    offsetMs = 0;
    lineIndex = -1;
    lastTimeMs = Number.NaN;
    wordSpans = [];
    lastGlow = [];
    entrance?.cancel();
    entrance = null;
  }

  function setTimeline(timeline: LyricsTimeline | null): void {
    if (disposed || timeline === shownTimeline) return;
    shownTimeline = timeline;
    resetSyncedState();
    if (!timeline || timeline.kind === 'empty') {
      root.replaceChildren();
      root.hidden = true;
      return;
    }
    root.hidden = false;
    if (timeline.kind === 'instrumental') {
      root.replaceChildren(createBlock('lyrics__instrumental', INSTRUMENTAL_TEXT));
      return;
    }
    if (timeline.kind === 'plain') {
      const block = createBlock('lyrics__plain', timeline.text);
      // Lets the wall's wheel handler hand scrolling back to this block (see pointerPan.ts).
      block.dataset.scrollable = 'true';
      root.replaceChildren(block);
      return;
    }
    lines = timeline.lines;
    offsetMs = timeline.offsetMs;
    root.replaceChildren(live, rows.current.root, rows.next.root);
    renderRows(-1, false);
  }

  function setOptions(next: LyricsViewOptions): void {
    const changed = next.showTranslation !== options.showTranslation || next.reducedMotion !== options.reducedMotion;
    options = { showTranslation: next.showTranslation, reducedMotion: next.reducedMotion };
    if (!changed || disposed) return;
    applyOptionAttributes();
    if (lines === null) return;
    renderRows(lineIndex, false);
    if (Number.isFinite(lastTimeMs)) applyProgress(lastTimeMs);
  }

  function update(positionMs: number): boolean {
    if (lines === null) return false;
    const timeMs = positionMs + offsetMs;
    const animate = Number.isFinite(lastTimeMs) && root.isConnected;
    lastTimeMs = timeMs;
    const index = findLineIndex(lines, timeMs);
    const changed = index !== lineIndex;
    if (changed) renderRows(index, animate);
    const hideNext = index + 1 >= lines.length;
    const nextVisibilityChanged = rows.next.root.hidden !== hideNext;
    if (nextVisibilityChanged) rows.next.root.hidden = hideNext;
    applyProgress(timeMs);
    return changed || nextVisibilityChanged;
  }

  function hasFollowingLine(): boolean {
    if (lines === null) return false;
    if (lineIndex < 0) return lines.length > 1;
    return lineIndex + 1 < lines.length;
  }

  function renderRows(index: number, animate: boolean): void {
    if (lines === null) return;
    lineIndex = index;
    const current = index >= 0 ? lines[index] : undefined;
    renderPlainRow(rows.next, lines[index + 1]);
    renderCurrentRow(current);
    const announcement = current?.text ?? '';
    if (live.textContent !== announcement) live.textContent = announcement;
    if (animate && current !== undefined && !options.reducedMotion) playEntrance();
  }

  function renderPlainRow(row: Row, line: LyricsLine | undefined): void {
    row.root.hidden = line === undefined;
    row.text.textContent = line === undefined ? '' : line.text || INTERLUDE_TEXT;
    row.translation.textContent = line?.translation ?? '';
  }

  function renderCurrentRow(line: LyricsLine | undefined): void {
    wordSpans = [];
    lastGlow = [];
    rows.current.translation.textContent = line?.translation ?? '';
    if (line === undefined) {
      rows.current.text.replaceChildren();
      return;
    }
    if (line.words.length === 0) {
      const span = createWordSpan(line.text || INTERLUDE_TEXT, true);
      wordSpans.push(span);
      rows.current.text.replaceChildren(span);
      return;
    }
    // Inline-block spans would swallow their own trailing spaces, so surrounding whitespace becomes text nodes.
    const nodes: Array<Node | string> = [];
    for (const word of line.words) {
      const core = word.text.trim();
      const leading = word.text.slice(0, word.text.length - word.text.trimStart().length);
      const trailing = word.text.slice(leading.length + core.length);
      if (leading) nodes.push(leading);
      const span = createWordSpan(core, false);
      wordSpans.push(span);
      nodes.push(span);
      if (trailing) nodes.push(trailing);
    }
    rows.current.text.replaceChildren(...nodes);
  }

  function applyProgress(timeMs: number): void {
    if (lines === null || lineIndex < 0) return;
    const line = lines[lineIndex];
    if (line === undefined) return;
    if (line.words.length === 0) {
      writeGlow(0, glowForLine(line, timeMs));
      return;
    }
    for (let i = 0; i < line.words.length; i += 1) writeGlow(i, glowForWord(line, i, timeMs));
  }

  function writeGlow(index: number, glow: WordGlow): void {
    if (lastGlow[index] === glow) return;
    lastGlow[index] = glow;
    const span = wordSpans[index];
    if (!span) return;
    span.classList.toggle('lyrics__word--active', glow === 'active');
    span.classList.toggle('lyrics__word--sung', glow === 'sung');
  }

  function playEntrance(): void {
    entrance?.cancel();
    entrance = rows.current.text.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: ENTRANCE_MS, easing: 'ease-out' },
    );
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    shownTimeline = null;
    resetSyncedState();
    for (const row of Object.values(rows)) {
      row.text.replaceChildren();
      row.translation.textContent = '';
    }
    live.textContent = '';
    root.replaceChildren();
    root.hidden = true;
    root.remove();
  }

  return {
    element: root,
    setTimeline,
    setOptions,
    update,
    hasFollowingLine,
    get needsFrames(): boolean {
      return lines !== null;
    },
    dispose,
  };
}

function createRow(role: RowRole): Row {
  const root = document.createElement('div');
  root.className = `lyrics__line lyrics__line--${role}`;
  root.setAttribute('aria-hidden', 'true');
  const text = document.createElement('div');
  text.className = 'lyrics__text';
  const translation = document.createElement('div');
  translation.className = 'lyrics__translation';
  root.append(text, translation);
  return { root, text, translation };
}

function glowForLine(line: LyricsLine, timeMs: number): WordGlow {
  if (timeMs < line.startMs) return 'upcoming';
  if (timeMs >= line.endMs) return 'sung';
  return 'active';
}

function glowForWord(line: LyricsLine, index: number, timeMs: number): WordGlow {
  const word = line.words[index];
  if (!word || timeMs < word.startMs) return 'upcoming';
  const next = line.words[index + 1];
  if (next && timeMs >= next.startMs) return 'sung';
  const endMs = word.endMs ?? next?.startMs ?? line.endMs;
  if (!next && timeMs >= endMs) return 'sung';
  return 'active';
}

function createWordSpan(text: string, wholeLine: boolean): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = wholeLine ? 'lyrics__word lyrics__word--line' : 'lyrics__word';
  span.textContent = text;
  return span;
}

function createBlock(className: string, text: string): HTMLElement {
  const block = document.createElement('div');
  block.className = className;
  block.textContent = text;
  return block;
}
