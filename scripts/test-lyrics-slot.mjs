import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveLyricsOpenHeight } from '../source/panel/lyrics/lyricsSlot.ts';

test('resolveLyricsOpenHeight keeps a following-row reserve when the next line is still 0', () => {
  const height = resolveLyricsOpenHeight({
    cap: 300,
    scrollHeight: 48,
    rowHeights: [48, 0],
    gap: 12,
    expectNext: true,
    estimatedCurrent: 40,
    estimatedNext: 28,
  });
  assert.equal(height, 48 + 28 + 12);
});

test('resolveLyricsOpenHeight uses laid-out rows when both are ready', () => {
  const height = resolveLyricsOpenHeight({
    cap: 300,
    scrollHeight: 80,
    rowHeights: [52, 30],
    gap: 12,
    expectNext: true,
    estimatedCurrent: 40,
    estimatedNext: 28,
  });
  assert.equal(height, 52 + 30 + 12);
});

test('resolveLyricsOpenHeight does not reserve a second row on the last line', () => {
  const height = resolveLyricsOpenHeight({
    cap: 300,
    scrollHeight: 88,
    rowHeights: [48, 28],
    gap: 12,
    expectNext: false,
    estimatedCurrent: 40,
    estimatedNext: 28,
  });
  assert.equal(height, 48);
});

test('resolveLyricsOpenHeight caps at 42% of the card', () => {
  const height = resolveLyricsOpenHeight({
    cap: 60,
    scrollHeight: 200,
    rowHeights: [80, 80],
    gap: 12,
    expectNext: true,
    estimatedCurrent: 40,
    estimatedNext: 28,
  });
  assert.equal(height, 60);
});
