import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildLyricsTimeline, findLineIndex, lineProgress, wordProgress } from '../source/panel/lyrics/lyricsModel.ts';

const sandbox = (overrides = {}) => ({
  kind: 'synced',
  title: 'Track',
  artist: 'Artist',
  album: null,
  durationSeconds: null,
  offsetMs: 0,
  provider: 'local',
  lines: [],
  plainText: null,
  syncedText: null,
  ...overrides,
});

const line = (timeMs, text, overrides = {}) => ({
  timeMs,
  text,
  translation: null,
  romanization: null,
  kana: null,
  words: [],
  ...overrides,
});

const word = (text, startMs, endMs = null) => ({ text, startMs, endMs });

const synced = (input) => {
  const timeline = buildLyricsTimeline(sandbox(input));
  assert.equal(timeline.kind, 'synced');
  return timeline;
};

describe('buildLyricsTimeline kind mapping', () => {
  test('null and empty become empty', () => {
    assert.deepEqual(buildLyricsTimeline(null), { kind: 'empty' });
    assert.deepEqual(buildLyricsTimeline(sandbox({ kind: 'empty', lines: [line(0, 'ignored')] })), { kind: 'empty' });
  });

  test('instrumental is passed through', () => {
    assert.deepEqual(buildLyricsTimeline(sandbox({ kind: 'instrumental' })), { kind: 'instrumental' });
  });

  test('plain uses the trimmed plainText', () => {
    assert.deepEqual(buildLyricsTimeline(sandbox({ kind: 'plain', plainText: '  verse one\nverse two  ' })), {
      kind: 'plain',
      text: 'verse one\nverse two',
    });
  });

  test('plain falls back to the joined line texts', () => {
    const timeline = buildLyricsTimeline(sandbox({
      kind: 'plain',
      plainText: '   ',
      lines: [line(0, ' first '), line(1000, ''), line(2000, 'third')],
    }));
    assert.deepEqual(timeline, { kind: 'plain', text: 'first\n\nthird' });
  });

  test('plain without any text becomes empty', () => {
    assert.deepEqual(buildLyricsTimeline(sandbox({ kind: 'plain', plainText: null, lines: [] })), { kind: 'empty' });
    assert.deepEqual(buildLyricsTimeline(sandbox({ kind: 'plain', plainText: ' ', lines: [line(0, '  ')] })), { kind: 'empty' });
  });
});

describe('synced lines', () => {
  test('lines are sorted by start time, keeping source order for equal starts', () => {
    const { lines } = synced({
      lines: [line(3000, 'c'), line(1000, 'a'), line(1000, 'b'), line(2000, 'x')],
    });
    assert.deepEqual(lines.map((entry) => entry.text), ['a', 'b', 'x', 'c']);
    assert.deepEqual(lines.map((entry) => entry.startMs), [1000, 1000, 2000, 3000]);
  });

  test('endMs is the next distinct start, and the last line lasts 5000 ms', () => {
    const { lines } = synced({
      lines: [line(1000, 'a'), line(1000, 'b'), line(2000, 'x'), line(3000, 'c')],
    });
    assert.deepEqual(lines.map((entry) => entry.endMs), [2000, 2000, 3000, 8000]);
  });

  test('duplicate starts at the end all get the 5000 ms tail', () => {
    const { lines } = synced({ lines: [line(1000, 'a'), line(1000, 'b')] });
    assert.deepEqual(lines.map((entry) => entry.endMs), [6000, 6000]);
  });

  test('a single line gets endMs = startMs + 5000', () => {
    const { lines } = synced({ lines: [line(250, 'solo')] });
    assert.deepEqual(lines, [{ startMs: 250, endMs: 5250, text: 'solo', translation: null, words: [] }]);
  });

  test('lines with invalid start times are dropped', () => {
    const { lines } = synced({
      lines: [line(-5, 'negative'), line(Number.NaN, 'nan'), line('12', 'string'), line(Number.POSITIVE_INFINITY, 'inf'), line(0, 'zero')],
    });
    assert.deepEqual(lines.map((entry) => entry.text), ['zero']);
  });

  test('only invalid lines yields empty', () => {
    assert.deepEqual(buildLyricsTimeline(sandbox({ lines: [line(-1, 'x'), line(Number.NaN, 'y')] })), { kind: 'empty' });
    assert.deepEqual(buildLyricsTimeline(sandbox({ lines: [] })), { kind: 'empty' });
  });

  test('text and translation are trimmed; empty-text lines are kept as interlude markers', () => {
    const { lines } = synced({
      lines: [line(0, '  hello  ', { translation: '  你好  ' }), line(1000, '   ', { translation: '   ' }), line(2000, 'x', { translation: null })],
    });
    assert.deepEqual(lines.map((entry) => [entry.text, entry.translation]), [['hello', '你好'], ['', null], ['x', null]]);
  });

  test('offsetMs is carried verbatim and non-finite offsets become 0', () => {
    assert.equal(synced({ offsetMs: -350, lines: [line(0, 'a')] }).offsetMs, -350);
    assert.equal(synced({ offsetMs: Number.NaN, lines: [line(0, 'a')] }).offsetMs, 0);
    assert.equal(synced({ offsetMs: undefined, lines: [line(0, 'a')] }).offsetMs, 0);
  });
});

describe('word normalisation', () => {
  test('words without a finite start are dropped', () => {
    const { lines } = synced({
      lines: [line(1000, 'b', { words: [word('a', Number.NaN), word('b', 1200), word('c', undefined)] })],
    });
    assert.deepEqual(lines[0].words, [{ text: 'b', startMs: 1200, endMs: null }]);
  });

  test('word starts are clamped to the line start', () => {
    const { lines } = synced({ lines: [line(1000, 'ab', { words: [word('a', 400, 1100), word('b', 1100, 1500)] })] });
    assert.deepEqual(lines[0].words.map((entry) => entry.startMs), [1000, 1100]);
  });

  test('null endMs is preserved, finite endMs is at least startMs + 1, non-finite endMs becomes null', () => {
    const { lines } = synced({
      lines: [line(1000, 'abcd', { words: [word('a', 1000, null), word('b', 1200, 1200), word('c', 1300, 900), word('d', 1400, Number.NaN)] })],
    });
    assert.deepEqual(lines[0].words.map((entry) => entry.endMs), [null, 1201, 1301, null]);
  });

  test('clamping the start also pushes a stale end forward', () => {
    const { lines } = synced({ lines: [line(1000, 'a', { words: [word('a', 400, 600)] })] });
    assert.deepEqual(lines[0].words, [{ text: 'a', startMs: 1000, endMs: 1001 }]);
  });

  test('inter-word whitespace is restored from the line text (the host trims each word)', () => {
    const { lines } = synced({
      lines: [line(0, 'Hello wide  world', { words: [word('Hello', 0, 400), word('wide', 400, 800), word('world', 800)] })],
    });
    assert.deepEqual(lines[0].words.map((entry) => entry.text), ['Hello ', 'wide  ', 'world']);
    assert.equal(lines[0].words.map((entry) => entry.text).join(''), lines[0].text);
  });

  test('syllable splits and CJK words stay adjacent when the line has no spaces there', () => {
    const { lines } = synced({
      lines: [
        line(0, 'Hel-lo you', { words: [word('Hel-', 0, 200), word('lo', 200, 400), word('you', 400)] }),
        line(1000, '我们的歌', { words: [word('我们', 1000, 1300), word('的', 1300, 1400), word('歌', 1400)] }),
      ],
    });
    assert.deepEqual(lines[0].words.map((entry) => entry.text), ['Hel-', 'lo ', 'you']);
    assert.deepEqual(lines[1].words.map((entry) => entry.text), ['我们', '的', '歌']);
  });

  test('words that already spell the line exactly are kept unchanged', () => {
    const { lines } = synced({ lines: [line(0, 'a b', { words: [word('a ', 0, 100), word('b', 100)] })] });
    assert.deepEqual(lines[0].words.map((entry) => entry.text), ['a ', 'b']);
  });

  test('words that do not spell the line fall back to whole-line progress', () => {
    const { lines } = synced({
      lines: [
        line(0, 'Hello world', { words: [word('Hello', 0, 400), word('wor', 400)] }),
        line(1000, '', { words: [word('ghost', 1000)] }),
        line(2000, 'no words'),
      ],
    });
    assert.deepEqual(lines.map((entry) => entry.words), [[], [], []]);
  });
});

describe('findLineIndex', () => {
  const lines = synced({ lines: [line(1000, 'a'), line(2000, 'b'), line(2000, 'c'), line(4000, 'd')] }).lines;

  test('boundaries', () => {
    assert.equal(findLineIndex([], 5000), -1);
    assert.equal(findLineIndex(lines, 0), -1);
    assert.equal(findLineIndex(lines, 999), -1);
    assert.equal(findLineIndex(lines, 1000), 0);
    assert.equal(findLineIndex(lines, 1500), 0);
    assert.equal(findLineIndex(lines, 3999), 2);
    assert.equal(findLineIndex(lines, 4000), 3);
    assert.equal(findLineIndex(lines, 99_999), 3);
    assert.equal(findLineIndex(lines, Number.NaN), -1);
  });

  test('duplicate starts resolve to the last duplicate', () => {
    assert.equal(findLineIndex(lines, 2000), 2);
    assert.equal(findLineIndex(lines, 2500), 2);
  });

  test('offsetMs is applied by the caller: the view looks up positionMs + offsetMs', () => {
    // The model only carries `offsetMs`; `LyricsView.update(positionMs)` computes `t = positionMs + offsetMs`
    // and hands `t` to findLineIndex / wordProgress. A +500 ms offset therefore reaches a line 500 ms earlier.
    const timeline = synced({ offsetMs: 500, lines: [line(1000, 'a'), line(2000, 'b')] });
    const positionMs = 600;
    assert.equal(findLineIndex(timeline.lines, positionMs), -1);
    assert.equal(findLineIndex(timeline.lines, positionMs + timeline.offsetMs), 0);
    assert.equal(findLineIndex(timeline.lines, 1500 + timeline.offsetMs), 1);
  });
});

describe('progress', () => {
  test('wordProgress clamps to 0..1 across the word span', () => {
    const timed = { text: 'a', startMs: 1000, endMs: 2000 };
    assert.equal(wordProgress(timed, 9000, 500), 0);
    assert.equal(wordProgress(timed, 9000, 1000), 0);
    assert.equal(wordProgress(timed, 9000, 1500), 0.5);
    assert.equal(wordProgress(timed, 9000, 2000), 1);
    assert.equal(wordProgress(timed, 9000, 2500), 1);
  });

  test('a word without its own end runs until the line end', () => {
    const open = { text: 'a', startMs: 1000, endMs: null };
    assert.equal(wordProgress(open, 3000, 2000), 0.5);
    assert.equal(wordProgress(open, 3000, 3500), 1);
  });

  test('zero or negative spans snap to 0 before the start and 1 from the start on', () => {
    const zero = { text: 'a', startMs: 1000, endMs: 1000 };
    const negative = { text: 'a', startMs: 1000, endMs: 500 };
    assert.equal(wordProgress(zero, 1000, 999), 0);
    assert.equal(wordProgress(zero, 1000, 1000), 1);
    assert.equal(wordProgress(negative, 1000, 999), 0);
    assert.equal(wordProgress(negative, 1000, 1000), 1);
    assert.equal(wordProgress({ text: 'a', startMs: 1000, endMs: null }, 1000, 1200), 1);
  });

  test('lineProgress mirrors wordProgress for the whole line', () => {
    const entry = { startMs: 1000, endMs: 5000, text: 'x', translation: null, words: [] };
    assert.equal(lineProgress(entry, 0), 0);
    assert.equal(lineProgress(entry, 3000), 0.5);
    assert.equal(lineProgress(entry, 9000), 1);
    assert.equal(lineProgress({ ...entry, endMs: 1000 }, 1000), 1);
    assert.equal(lineProgress({ ...entry, endMs: 1000 }, 999), 0);
  });

  test('a NaN clock never produces NaN progress', () => {
    assert.equal(wordProgress({ text: 'a', startMs: 0, endMs: 100 }, 100, Number.NaN), 0);
    assert.equal(lineProgress({ startMs: 0, endMs: 100, text: '', translation: null, words: [] }, Number.NaN), 0);
  });
});
