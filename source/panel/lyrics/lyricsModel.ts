/**
 * Pure lyrics timeline model (SPEC §9): normalises host `EchoWorkshopSandboxLyrics` into the
 * `LyricsTimeline` contract and provides the time lookups the view runs every frame. No DOM, so Node
 * executes this file directly from `scripts/test-lyrics.mjs`.
 */
import type { LyricsLine, LyricsTimeline, LyricsWord } from '../types.ts';

type SandboxLine = EchoWorkshopSandboxLyrics['lines'][number];
type SandboxWord = SandboxLine['words'][number];

const LAST_LINE_DURATION_MS = 5000;
const WHITESPACE_RUN = /\s+/gu;
const WHITESPACE_CHAR = /\s/u;

export function buildLyricsTimeline(lyrics: EchoWorkshopSandboxLyrics | null): LyricsTimeline {
  if (!lyrics || lyrics.kind === 'empty') return { kind: 'empty' };
  if (lyrics.kind === 'instrumental') return { kind: 'instrumental' };
  const sourceLines = Array.isArray(lyrics.lines) ? lyrics.lines : [];
  if (lyrics.kind === 'plain') {
    const text = trimmed(lyrics.plainText) || joinLineTexts(sourceLines);
    return text ? { kind: 'plain', text } : { kind: 'empty' };
  }
  const lines = buildSyncedLines(sourceLines);
  if (lines.length === 0) return { kind: 'empty' };
  return { kind: 'synced', lines, offsetMs: Number.isFinite(lyrics.offsetMs) ? lyrics.offsetMs : 0 };
}

/** Index of the last line with `startMs <= timeMs`, or -1 before the first line. */
export function findLineIndex(lines: LyricsLine[], timeMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const line = lines[mid];
    if (line !== undefined && line.startMs <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** 0..1 sweep progress of a word; a word without its own end runs until the line ends. */
export function wordProgress(word: LyricsWord, lineEndMs: number, timeMs: number): number {
  return progressBetween(word.startMs, word.endMs ?? lineEndMs, timeMs);
}

/** 0..1 progress of a whole line (used when the line has no word timings). */
export function lineProgress(line: LyricsLine, timeMs: number): number {
  return progressBetween(line.startMs, line.endMs, timeMs);
}

function progressBetween(startMs: number, endMs: number, timeMs: number): number {
  const span = endMs - startMs;
  if (!(span > 0)) return timeMs >= startMs ? 1 : 0;
  const progress = (timeMs - startMs) / span;
  if (!(progress > 0)) return 0;
  return progress < 1 ? progress : 1;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function joinLineTexts(lines: SandboxLine[]): string {
  return lines.map((line) => trimmed(line.text)).join('\n').trim();
}

function buildSyncedLines(source: SandboxLine[]): LyricsLine[] {
  const ordered = source
    .filter((line) => Number.isFinite(line.timeMs) && line.timeMs >= 0)
    .map((line, order) => ({ line, order }))
    .sort((a, b) => a.line.timeMs - b.line.timeMs || a.order - b.order)
    .map((entry) => entry.line);
  return ordered.map((line, index) => {
    const startMs = line.timeMs;
    const text = trimmed(line.text);
    return {
      startMs,
      endMs: Math.max(startMs + 1, nextDistinctStart(ordered, index, startMs) ?? startMs + LAST_LINE_DURATION_MS),
      text,
      translation: trimmed(line.translation) || null,
      words: normaliseWords(line.words, startMs, text),
    };
  });
}

function nextDistinctStart(lines: SandboxLine[], index: number, startMs: number): number | null {
  for (let i = index + 1; i < lines.length; i += 1) {
    const candidate = lines[i];
    if (candidate !== undefined && candidate.timeMs > startMs) return candidate.timeMs;
  }
  return null;
}

function normaliseWords(source: SandboxWord[], lineStartMs: number, lineText: string): LyricsWord[] {
  if (!Array.isArray(source) || source.length === 0) return [];
  const words: LyricsWord[] = [];
  for (const candidate of source) {
    if (!Number.isFinite(candidate.startMs)) continue;
    const startMs = Math.max(lineStartMs, candidate.startMs);
    const endMs = typeof candidate.endMs === 'number' && Number.isFinite(candidate.endMs)
      ? Math.max(startMs + 1, candidate.endMs)
      : null;
    words.push({ text: typeof candidate.text === 'string' ? candidate.text : '', startMs, endMs });
  }
  return alignWordsToText(words, lineText) ?? [];
}

/**
 * The current row is rendered from word spans, so the words must spell the line text. The host trims
 * every word, which loses inter-word spaces ("Hello" + "world" for "Hello world"); they are restored
 * from the line text. Words that do not spell the line at all yield null (whole-line progress).
 */
function alignWordsToText(words: LyricsWord[], lineText: string): LyricsWord[] | null {
  const joined = words.map((word) => word.text).join('');
  if (joined === lineText) return words;
  if (joined.replace(WHITESPACE_RUN, '') !== lineText.replace(WHITESPACE_RUN, '')) return null;
  let cursor = 0;
  return words.map((word) => {
    const start = cursor;
    let remaining = word.text.replace(WHITESPACE_RUN, '').length;
    while (cursor < lineText.length && remaining > 0) {
      if (!WHITESPACE_CHAR.test(lineText.charAt(cursor))) remaining -= 1;
      cursor += 1;
    }
    while (cursor < lineText.length && WHITESPACE_CHAR.test(lineText.charAt(cursor))) cursor += 1;
    return { text: lineText.slice(start, cursor), startMs: word.startMs, endMs: word.endMs };
  });
}
